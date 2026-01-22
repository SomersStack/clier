/**
 * Daemon Controller
 *
 * Exposes Watcher functionality via RPC methods.
 * This is the bridge between the IPC layer and the Watcher.
 */

import type { Watcher } from "../watcher.js";
import type { ProcessStatus } from "../core/process-manager.js";
import type { LogEntry } from "../core/log-manager.js";

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
  async "process.stop"(params: { name: string }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    await manager.stopProcess(params.name);
    return { success: true };
  }

  /**
   * Restart a specific process
   */
  async "process.restart"(params: {
    name: string;
  }): Promise<{ success: true }> {
    const manager = this.watcher.getProcessManager();
    if (!manager) {
      throw new Error("ProcessManager not initialized");
    }
    await manager.restartProcess(params.name);
    return { success: true };
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
}
