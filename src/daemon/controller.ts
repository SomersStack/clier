/**
 * Daemon Controller
 *
 * Exposes Watcher functionality via RPC methods.
 * This is the bridge between the IPC layer and the Watcher.
 */

import type { Watcher } from "../watcher.js";
import type { ProcessStatus } from "../core/process-manager.js";
import type { LogEntry } from "../core/log-manager.js";
import type { ClierEvent } from "../types/events.js";

/**
 * Daemon status information
 */
export interface DaemonStatus {
  uptime: number;
  processCount: number;
  configPath: string;
  pid: number;
}

/**
 * DaemonController class
 *
 * Provides RPC methods that CLI clients can call via the IPC server.
 * Each method corresponds to a daemon operation.
 */
export class DaemonController {
  private startTime = Date.now();

  constructor(private watcher: Watcher) {}

  /**
   * Health check - verify daemon is responsive
   */
  async ping(): Promise<{ pong: true }> {
    return { pong: true };
  }

  /**
   * List all processes managed by the daemon
   */
  async "process.list"(): Promise<ProcessStatus[]> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    return manager.listProcesses();
  }

  /**
   * Stop a specific process
   */
  async "process.stop"(params: {
    name: string;
    force?: boolean;
  }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    await manager.stopProcess(params.name, params.force ?? false);
    return { success: true };
  }

  /**
   * Restart a specific process
   */
  async "process.restart"(params: {
    name: string;
    force?: boolean;
  }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    await manager.restartProcess(params.name, params.force ?? false);
    return { success: true };
  }

  /**
   * Add a new process to the pipeline
   */
  async "process.add"(params: {
    config: import("../core/managed-process.js").ProcessConfig;
  }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    await manager.startProcess(params.config);
    return { success: true };
  }

  /**
   * Delete a process from the pipeline
   */
  async "process.delete"(params: {
    name: string;
  }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    await manager.deleteProcess(params.name);
    return { success: true };
  }

  /**
   * Start a pipeline stage by name
   *
   * Directly starts a stage, bypassing event triggers.
   * Works with manual stages and stages waiting for events.
   */
  async "process.start"(params: {
    name: string;
  }): Promise<{ success: true }> {
    await this.watcher.triggerStage(params.name);
    return { success: true };
  }

  /**
   * Write input to a running process's stdin
   *
   * Sends data to a process that has input enabled in its configuration.
   * The data is written directly to the process's stdin stream.
   */
  async "process.input"(params: {
    name: string;
    data: string;
    appendNewline?: boolean;
  }): Promise<{ success: true; bytesWritten: number }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }

    if (!manager.hasInputEnabled(params.name)) {
      throw new Error(
        `Input not enabled for process "${params.name}". ` +
          `Enable it in clier-pipeline.json with: input: { enabled: true }`
      );
    }

    const data = params.appendNewline ? params.data + "\n" : params.data;
    manager.writeInput(params.name, data);

    return { success: true, bytesWritten: data.length };
  }

  /**
   * Check if a process has input enabled
   */
  async "process.inputEnabled"(params: {
    name: string;
  }): Promise<{ enabled: boolean }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }

    return { enabled: manager.hasInputEnabled(params.name) };
  }

  /**
   * Query logs for a specific process
   */
  async "logs.query"(params: {
    name: string;
    lines?: number;
    since?: number;
  }): Promise<LogEntry[]> {
    const logManager = this.watcher.getLogManager();
    if (!logManager) {
      throw new Error("LogManager not initialized");
    }

    if (params.since !== undefined) {
      return logManager.getSince(params.name, params.since);
    }

    return logManager.getLastN(params.name, params.lines || 100);
  }

  /**
   * Clear logs for a specific process or all processes
   */
  async "logs.clear"(params: {
    name?: string;
  }): Promise<{ success: true; cleared: string[] }> {
    const logManager = this.watcher.getLogManager();
    if (!logManager) {
      throw new Error("LogManager not initialized");
    }

    const cleared: string[] = [];

    if (params.name) {
      // Clear logs for a specific process
      logManager.deleteLogFiles(params.name);
      cleared.push(params.name);
    } else {
      // Clear all process logs
      const processNames = logManager.getProcessNames();
      logManager.deleteAllLogFiles();
      cleared.push(...processNames);
    }

    return { success: true, cleared };
  }

  /**
   * Reload configuration
   */
  async "config.reload"(params: {
    configPath: string;
  }): Promise<{ success: true }> {
    // Stop current watcher
    await this.watcher.stop();

    // Restart with new config
    await this.watcher.start(params.configPath);

    return { success: true };
  }

  /**
   * Reload configuration with option to restart manually triggered services
   *
   * When restartManualServices is true, any services that were manually started
   * (via `clier service start`) will be re-triggered after the reload completes.
   */
  async "config.clearReload"(params: {
    configPath: string;
    restartManualServices?: boolean;
  }): Promise<{ success: true; restartedServices: string[] }> {
    // Get manually triggered services before reload (if we need to restart them)
    const manualServices = params.restartManualServices
      ? this.watcher.getManuallyTriggeredProcesses()
      : [];

    // Stop current watcher
    await this.watcher.stop();

    // Restart with new config
    await this.watcher.start(params.configPath);

    // Re-trigger manually started services if requested
    const restartedServices: string[] = [];
    if (params.restartManualServices && manualServices.length > 0) {
      for (const serviceName of manualServices) {
        try {
          await this.watcher.triggerStage(serviceName);
          restartedServices.push(serviceName);
        } catch (error) {
          // Log but continue - service might not exist in new config
          console.error(`Failed to restart manual service "${serviceName}":`, error);
        }
      }
    }

    return { success: true, restartedServices };
  }

  /**
   * Get daemon status
   */
  async "daemon.status"(): Promise<DaemonStatus> {
    const manager = this.watcher.getProcessManager();
    const processes = manager?.listProcesses() || [];

    return {
      uptime: Date.now() - this.startTime,
      processCount: processes.length,
      configPath: process.env.CLIER_CONFIG_PATH || "",
      pid: process.pid,
    };
  }

  /**
   * Shutdown the daemon gracefully
   */
  async "daemon.shutdown"(): Promise<{ success: true }> {
    // Trigger graceful shutdown
    process.kill(process.pid, "SIGTERM");
    return { success: true };
  }

  /**
   * Get daemon logs (from Winston log files)
   */
  async "daemon.logs"(params: {
    lines?: number;
    level?: "combined" | "error";
  }): Promise<string[]> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { findProjectRoot } = await import("../utils/project-root.js");

    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      throw new Error("Could not find project root");
    }

    const logFile =
      params.level === "error" ? "error.log" : "combined.log";
    const logPath = path.join(projectRoot, ".clier", "logs", logFile);

    try {
      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const limit = params.lines || 100;

      // Return last N lines
      return lines.slice(-limit);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Clear daemon logs (combined.log and/or error.log)
   */
  async "daemon.logs.clear"(params: {
    level?: "combined" | "error" | "all";
  }): Promise<{ success: true; cleared: string[] }> {
    const fs = await import("fs/promises");
    const path = await import("path");
    const { findProjectRoot } = await import("../utils/project-root.js");

    const projectRoot = findProjectRoot();
    if (!projectRoot) {
      throw new Error("Could not find project root");
    }

    const logsDir = path.join(projectRoot, ".clier", "logs");
    const cleared: string[] = [];
    const level = params.level || "all";

    const filesToClear: string[] = [];
    if (level === "all" || level === "combined") {
      filesToClear.push("combined.log");
    }
    if (level === "all" || level === "error") {
      filesToClear.push("error.log");
    }

    for (const file of filesToClear) {
      const logPath = path.join(logsDir, file);
      try {
        await fs.unlink(logPath);
        cleared.push(file);
      } catch (error) {
        // Ignore if file doesn't exist
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        ) {
          throw error;
        }
      }
    }

    return { success: true, cleared };
  }

  /**
   * Emit a custom event to trigger waiting pipeline stages
   *
   * This allows CLI or agents to manually emit events that would normally
   * come from process output patterns. Stages with matching trigger_on
   * will be started if all their dependencies are satisfied.
   */
  async "event.emit"(params: {
    eventName: string;
    data?: string | Record<string, unknown>;
  }): Promise<{ success: true; triggeredStages: string[] }> {
    const triggeredStages = await this.watcher.emitEvent(
      params.eventName,
      params.data
    );
    return { success: true, triggeredStages };
  }

  /**
   * Query event history
   *
   * Returns recent events that have been processed by the event handler.
   * Supports filtering by process name, event type, event name, and time.
   */
  async "events.query"(params: {
    processName?: string;
    eventType?: "success" | "error" | "crashed" | "custom" | "stdout" | "stderr";
    eventName?: string;
    lines?: number;
    since?: number;
  }): Promise<ClierEvent[]> {
    const eventHandler = this.watcher.getEventHandler();
    if (!eventHandler) {
      throw new Error("EventHandler not initialized");
    }

    let events = eventHandler.getEventHistory();

    // Filter by process name
    if (params.processName) {
      events = events.filter((e) => e.processName === params.processName);
    }

    // Filter by event type
    if (params.eventType) {
      events = events.filter((e) => e.type === params.eventType);
    }

    // Filter by event name (supports partial matching)
    if (params.eventName) {
      const pattern = params.eventName.toLowerCase();
      events = events.filter((e) => e.name.toLowerCase().includes(pattern));
    }

    // Filter by timestamp (since)
    if (params.since !== undefined) {
      events = events.filter((e) => e.timestamp >= params.since!);
    }

    // Limit number of results (default 100)
    const limit = params.lines || 100;
    if (events.length > limit) {
      events = events.slice(-limit);
    }

    return events;
  }

}
