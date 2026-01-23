/**
 * Process Manager
 *
 * Manages processes using native child_process spawning.
 * Replaces PM2 with a simpler, more reliable implementation
 * that guarantees stdout capture before exit events.
 */

import { EventEmitter } from "events";
import {
  ManagedProcess,
  ProcessConfig,
  ProcessStatus,
  ExitLogs,
} from "./managed-process.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("ProcessManager");

// Re-export types for convenience
export { ProcessConfig, ProcessStatus, ExitLogs } from "./managed-process.js";

/**
 * Events emitted by ProcessManager
 */
export interface ProcessManagerEvents {
  stdout: (name: string, data: string, timestamp: number) => void;
  stderr: (name: string, data: string, timestamp: number) => void;
  exit: (
    name: string,
    code: number | null,
    signal: string | null,
    logs: ExitLogs
  ) => void;
  start: (name: string, pid: number) => void;
  restart: (name: string, attempt: number) => void;
  error: (name: string, error: Error) => void;
}

/**
 * ProcessManager class
 *
 * Manages a collection of ManagedProcess instances.
 * Provides lifecycle operations and event aggregation.
 *
 * @example
 * ```ts
 * const manager = new ProcessManager();
 *
 * manager.on('stdout', (name, data) => {
 *   console.log(`[${name}] ${data}`);
 * });
 *
 * await manager.startProcess({
 *   name: 'backend',
 *   command: 'npm start',
 *   cwd: '/app/backend',
 *   type: 'service'
 * });
 *
 * const processes = manager.listProcesses();
 * await manager.stopProcess('backend');
 * ```
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();

  constructor() {
    super();
  }

  /**
   * Start a new process
   *
   * @param config - Process configuration
   * @throws Error if process with same name already exists
   *
   * @example
   * ```ts
   * await manager.startProcess({
   *   name: 'backend',
   *   command: 'npm start',
   *   cwd: '/app/backend',
   *   type: 'service'
   * });
   * ```
   */
  async startProcess(config: ProcessConfig): Promise<void> {
    // Check if process already exists
    if (this.processes.has(config.name)) {
      const existing = this.processes.get(config.name)!;
      if (existing.isRunning) {
        throw new Error(`Process "${config.name}" is already running`);
      }
      // Remove stopped process to allow restart with new config
      this.processes.delete(config.name);
    }

    logger.info("Starting process", {
      name: config.name,
      command: config.command,
      type: config.type,
    });

    const managedProcess = new ManagedProcess(config);
    this.setupProcessListeners(managedProcess);
    this.processes.set(config.name, managedProcess);

    await managedProcess.start();
  }

  /**
   * Stop a running process
   *
   * @param name - Process name
   * @param force - If true, immediately use SIGKILL (default: false)
   * @param timeout - Timeout before force kill in ms (default: 5000)
   * @throws Error if process not found
   *
   * @example
   * ```ts
   * await manager.stopProcess('backend');
   * await manager.stopProcess('backend', true); // Force kill
   * ```
   */
  async stopProcess(
    name: string,
    force = false,
    timeout = 5000
  ): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }

    logger.info("Stopping process", { name, force });
    await process.stop(force, timeout);
  }

  /**
   * Restart a process
   *
   * @param name - Process name
   * @param force - If true, use SIGKILL for the stop phase (default: false)
   * @throws Error if process not found
   *
   * @example
   * ```ts
   * await manager.restartProcess('backend');
   * await manager.restartProcess('backend', true); // Force restart
   * ```
   */
  async restartProcess(name: string, force = false): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      throw new Error(`Process "${name}" not found`);
    }

    logger.info("Restarting process", { name, force });
    await process.restart(force);
  }

  /**
   * Delete a process (stop and remove from tracking)
   *
   * @param name - Process name
   *
   * @example
   * ```ts
   * await manager.deleteProcess('backend');
   * ```
   */
  async deleteProcess(name: string): Promise<void> {
    const process = this.processes.get(name);
    if (!process) {
      return; // Already deleted, no-op
    }

    if (process.isRunning) {
      await process.stop();
    }

    this.processes.delete(name);
    logger.debug("Process deleted", { name });
  }

  /**
   * Get status of a specific process
   *
   * @param name - Process name
   * @returns Process status or undefined if not found
   *
   * @example
   * ```ts
   * const status = manager.getStatus('backend');
   * if (status?.status === 'running') {
   *   console.log('Backend is running');
   * }
   * ```
   */
  getStatus(name: string): ProcessStatus | undefined {
    return this.processes.get(name)?.status;
  }

  /**
   * List all processes
   *
   * @returns Array of process statuses
   *
   * @example
   * ```ts
   * const processes = manager.listProcesses();
   * console.log(`Found ${processes.length} processes`);
   * ```
   */
  listProcesses(): ProcessStatus[] {
    return Array.from(this.processes.values()).map((p) => p.status);
  }

  /**
   * Check if a process is running
   *
   * @param name - Process name
   * @returns True if process exists and is running
   *
   * @example
   * ```ts
   * if (manager.isRunning('backend')) {
   *   console.log('Backend is running');
   * }
   * ```
   */
  isRunning(name: string): boolean {
    return this.processes.get(name)?.isRunning ?? false;
  }

  /**
   * Graceful shutdown of all processes
   *
   * @param timeout - Timeout for graceful shutdown per process (default: 5000ms)
   *
   * @example
   * ```ts
   * await manager.shutdown();
   * ```
   */
  async shutdown(timeout = 5000): Promise<void> {
    logger.info("Shutting down all processes", {
      count: this.processes.size,
    });

    // Phase 1: Send SIGTERM to all running processes
    const stopPromises = Array.from(this.processes.values())
      .filter((p) => p.isRunning)
      .map((p) =>
        p.stop(false, timeout).catch((err) => {
          logger.warn("Error stopping process during shutdown", {
            name: p.name,
            error: err.message,
          });
        })
      );

    await Promise.all(stopPromises);

    // Clear all processes
    this.processes.clear();
    logger.info("All processes shut down");
  }

  /**
   * Setup event listeners for a managed process
   */
  private setupProcessListeners(process: ManagedProcess): void {
    const name = process.name;

    process.on("stdout", (data: string, timestamp: number) => {
      this.emit("stdout", name, data, timestamp);
    });

    process.on("stderr", (data: string, timestamp: number) => {
      this.emit("stderr", name, data, timestamp);
    });

    process.on(
      "exit",
      (code: number | null, signal: string | null, logs: ExitLogs) => {
        this.emit("exit", name, code, signal, logs);
      }
    );

    process.on("start", (pid: number) => {
      this.emit("start", name, pid);
    });

    process.on("restart", (attempt: number) => {
      this.emit("restart", name, attempt);
    });

    process.on("error", (error: Error) => {
      this.emit("error", name, error);
    });
  }
}
