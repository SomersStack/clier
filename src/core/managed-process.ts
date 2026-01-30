/**
 * ManagedProcess - Individual process wrapper with guaranteed stdout capture
 *
 * Spawns a process via child_process and ensures ALL stdout/stderr is captured
 * before emitting the exit event. This fixes the race condition where PM2's
 * event bus could deliver exit events before stdout was fully received.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("ManagedProcess");

/**
 * Configuration for a managed process
 */
export interface ProcessConfig {
  /** Unique process name */
  name: string;
  /** Command to execute (passed to shell) */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Process type: service (long-running, auto-restart) or task (one-shot) */
  type: "service" | "task";
  /** Restart policy for services */
  restart?: RestartPolicy;
  /**
   * Whether to spawn process in detached mode (new process group).
   * When true (default), allows killing entire process tree on stop.
   * Set to false in tests to ensure child processes die with the test runner.
   */
  detached?: boolean;
  /**
   * Input configuration for stdin support.
   * When enabled, stdin is piped to the process allowing writes via writeInput().
   */
  input?: {
    enabled: boolean;
  };
}

/**
 * Restart policy configuration
 */
export interface RestartPolicy {
  /** Enable auto-restart (default: true for services, false for tasks) */
  enabled?: boolean;
  /** Maximum restart attempts before giving up (default: 10) */
  maxRetries?: number;
  /** Base delay in ms before restart (default: 1000) */
  delay?: number;
  /** Backoff strategy (default: exponential) */
  backoff?: "linear" | "exponential";
  /** Maximum delay cap in ms (default: 60000) */
  maxDelay?: number;
  /** Restart mode: "always" restarts on any exit, "on-failure" only on non-zero exit */
  mode?: "always" | "on-failure";
}

/**
 * Process status information
 */
export interface ProcessStatus {
  name: string;
  pid?: number;
  status: "running" | "stopped" | "crashed" | "restarting";
  uptime: number;
  restarts: number;
  exitCode?: number;
  signal?: string;
}

/**
 * Buffered logs from a process exit
 */
export interface ExitLogs {
  stdout: string[];
  stderr: string[];
}

/**
 * Events emitted by ManagedProcess
 */
export interface ManagedProcessEvents {
  stdout: (data: string, timestamp: number) => void;
  stderr: (data: string, timestamp: number) => void;
  exit: (code: number | null, signal: string | null, logs: ExitLogs) => void;
  start: (pid: number) => void;
  restart: (attempt: number) => void;
  error: (error: Error) => void;
}

/**
 * ManagedProcess class
 *
 * Wraps a child process with guaranteed stdout/stderr capture before exit.
 */
export class ManagedProcess extends EventEmitter {
  private child?: ChildProcess;
  private config: ProcessConfig;

  // State tracking
  private _status: ProcessStatus["status"] = "stopped";
  private restartCount = 0;
  private lastStartTime?: number;
  private lastExitCode?: number;
  private lastSignal?: string;
  private restartTimer?: NodeJS.Timeout;
  private stopRequested = false;

  // Buffering for guaranteed stdout capture
  private pendingStdout: string[] = [];
  private pendingStderr: string[] = [];
  private stdoutClosed = false;
  private stderrClosed = false;
  private exitInfo?: { code: number | null; signal: string | null };

  constructor(config: ProcessConfig) {
    super();
    this.config = config;
  }

  /**
   * Get current process status
   */
  get status(): ProcessStatus {
    return {
      name: this.config.name,
      pid: this.child?.pid,
      status: this._status,
      // Only count uptime while actually running
      uptime: this._status === "running" && this.lastStartTime
        ? Date.now() - this.lastStartTime
        : 0,
      restarts: this.restartCount,
      exitCode: this.lastExitCode,
      signal: this.lastSignal,
    };
  }

  /**
   * Get process name
   */
  get name(): string {
    return this.config.name;
  }

  /**
   * Check if process is running
   */
  get isRunning(): boolean {
    return this._status === "running";
  }

  /**
   * Check if input is enabled for this process
   */
  get inputEnabled(): boolean {
    return this.config.input?.enabled ?? false;
  }

  /**
   * Write data to process stdin
   *
   * @param data - String data to write to stdin
   * @throws Error if input is not enabled or process is not running
   */
  writeInput(data: string): void {
    if (!this.config.input?.enabled) {
      throw new Error(`Input not enabled for process "${this.config.name}"`);
    }
    if (!this.child?.stdin || this._status !== "running") {
      throw new Error(`Process "${this.config.name}" is not running`);
    }

    this.child.stdin.write(data);
    logger.debug("Wrote input to process", {
      name: this.config.name,
      bytes: data.length,
    });
  }

  /**
   * Start the process
   */
  async start(): Promise<void> {
    if (this._status === "running") {
      logger.warn("Process already running", { name: this.config.name });
      return;
    }

    this.stopRequested = false;
    this.resetBuffers();

    logger.info("Starting process", {
      name: this.config.name,
      command: this.config.command,
      type: this.config.type,
    });

    try {
      // Spawn process with shell to handle command parsing
      // Use detached: true (default) to create a new process group, so we can kill
      // the entire process tree (shell + children) when stopping.
      // Set detached: false in tests to ensure child processes die with the test runner.
      const detached = this.config.detached !== false;
      this.child = spawn(this.config.command, [], {
        cwd: this.config.cwd || process.cwd(),
        env: { ...process.env, ...this.config.env },
        shell: true,
        stdio: [this.config.input?.enabled ? "pipe" : "ignore", "pipe", "pipe"],
        detached,
      });

      this.lastStartTime = Date.now();
      this._status = "running";

      this.setupStreamHandlers();
      this.setupExitHandler();

      if (this.child.pid) {
        this.emit("start", this.child.pid);
        logger.debug("Process started", {
          name: this.config.name,
          pid: this.child.pid,
        });
      }
    } catch (error) {
      this._status = "crashed";
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Failed to start process", {
        name: this.config.name,
        error: err.message,
      });
      this.emit("error", err);
      throw err;
    }
  }

  /**
   * Stop the process
   *
   * @param force - If true, immediately use SIGKILL instead of graceful shutdown
   * @param timeout - Milliseconds to wait before force-killing (default: 5000)
   */
  async stop(force = false, timeout = 5000): Promise<void> {
    if (this._status !== "running" || !this.child) {
      logger.debug("Process not running, nothing to stop", {
        name: this.config.name,
      });
      return;
    }

    this.stopRequested = true;

    // Clear any pending restart
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    const pid = this.child.pid;
    const signal = force ? "SIGKILL" : "SIGTERM";

    logger.info("Stopping process", {
      name: this.config.name,
      signal,
      pid,
      force,
    });

    return new Promise((resolve) => {
      let resolved = false;
      const safeResolve = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const forceKillTimer = setTimeout(() => {
        if (this.child && this._status === "running" && this.child.pid) {
          const detached = this.config.detached !== false;
          logger.warn(detached ? "Force killing process group" : "Force killing process", {
            name: this.config.name,
            pid: this.child.pid,
          });
          // Kill process (or entire process group if detached) with SIGKILL
          try {
            if (detached) {
              process.kill(-this.child.pid, "SIGKILL");
            } else {
              this.child.kill("SIGKILL");
            }
          } catch (err) {
            logger.error("Failed to force kill process", {
              name: this.config.name,
              pid: this.child.pid,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // Force cleanup after SIGKILL - don't wait for streams
          // Schedule a final verification that process is dead
          setTimeout(() => {
            if (pid && this.isProcessAlive(pid)) {
              logger.error("Process still alive after SIGKILL", {
                name: this.config.name,
                pid,
              });
            } else {
              logger.debug("Process confirmed dead after SIGKILL", {
                name: this.config.name,
                pid,
              });
            }

            // Force emit exit event if it hasn't fired yet
            if (this._status === "running") {
              logger.warn(
                "Forcing exit event emission - streams may not have closed",
                {
                  name: this.config.name,
                  pid,
                }
              );
              this.forceExitCleanup();
            }

            safeResolve();
          }, 500); // Give process 500ms to die after SIGKILL
        }
      }, timeout);

      const cleanup = () => {
        clearTimeout(forceKillTimer);
        safeResolve();
      };

      // Listen for exit
      this.once("exit", cleanup);

      // Send signal to process (or process group if detached)
      if (this.child!.pid) {
        const detached = this.config.detached !== false;
        if (detached) {
          // Kill entire process group (negative PID) - ensures all child processes are killed
          try {
            process.kill(-this.child!.pid, signal);
          } catch (err) {
            // Fallback to killing just the main process if group kill fails
            logger.warn("Failed to kill process group, trying single process", {
              name: this.config.name,
              pid: this.child!.pid,
              error: err instanceof Error ? err.message : String(err),
            });
            this.child!.kill(signal);
          }
        } else {
          // Non-detached: just kill the main process, children will die with it
          this.child!.kill(signal);
        }
      } else {
        this.child!.kill(signal);
      }
    });
  }

  /**
   * Restart the process
   *
   * @param force - If true, use SIGKILL for the stop phase
   */
  async restart(force = false): Promise<void> {
    await this.stop(force);
    this.restartCount = 0; // Reset count on manual restart
    await this.start();
  }

  /**
   * Setup stdout/stderr stream handlers
   */
  private setupStreamHandlers(): void {
    if (!this.child) return;

    // Handle stdout
    this.child.stdout?.on("data", (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split("\n")
        .filter((line) => line.length > 0);

      for (const line of lines) {
        const timestamp = Date.now();
        this.pendingStdout.push(line);
        this.emit("stdout", line, timestamp);
      }
    });

    this.child.stdout?.on("close", () => {
      this.stdoutClosed = true;
      this.maybeEmitExit();
    });

    // Handle stderr
    this.child.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .split("\n")
        .filter((line) => line.length > 0);

      for (const line of lines) {
        const timestamp = Date.now();
        this.pendingStderr.push(line);
        this.emit("stderr", line, timestamp);
      }
    });

    this.child.stderr?.on("close", () => {
      this.stderrClosed = true;
      this.maybeEmitExit();
    });
  }

  /**
   * Setup process exit handler
   */
  private setupExitHandler(): void {
    if (!this.child) return;

    this.child.on("exit", (code, signal) => {
      this.exitInfo = { code, signal: signal || null };
      this.lastExitCode = code ?? undefined;
      this.lastSignal = signal ?? undefined;
      this.maybeEmitExit();
    });

    this.child.on("error", (error) => {
      logger.error("Process error", {
        name: this.config.name,
        error: error.message,
      });
      this.emit("error", error);
    });
  }

  /**
   * Emit exit event only after ALL streams are closed
   *
   * This is the key fix for the PM2 race condition - we guarantee
   * that all stdout/stderr has been captured before the exit event fires.
   */
  private maybeEmitExit(): void {
    // Wait for all three conditions: exit received + both streams closed
    if (!this.exitInfo || !this.stdoutClosed || !this.stderrClosed) {
      return;
    }

    const { code, signal } = this.exitInfo;

    // Update status
    if (code === 0) {
      this._status = "stopped";
    } else {
      this._status = "crashed";
    }

    logger.info("Process exited", {
      name: this.config.name,
      code,
      signal,
      stdoutLines: this.pendingStdout.length,
      stderrLines: this.pendingStderr.length,
    });

    // Emit exit with complete logs
    const logs: ExitLogs = {
      stdout: [...this.pendingStdout],
      stderr: [...this.pendingStderr],
    };

    this.emit("exit", code, signal, logs);

    // Clear buffers
    this.resetBuffers();

    // Handle auto-restart for services
    if (this.shouldAutoRestart(code)) {
      this.scheduleRestart();
    }
  }

  /**
   * Check if process should auto-restart
   */
  private shouldAutoRestart(exitCode: number | null): boolean {
    // Never restart if stop was requested
    if (this.stopRequested) {
      return false;
    }

    // Tasks don't auto-restart
    if (this.config.type === "task") {
      return false;
    }

    // Check restart policy
    const policy = this.config.restart;
    if (policy?.enabled === false) {
      return false;
    }

    // Check restart mode — "on-failure" skips restart on exit 0
    const mode = policy?.mode ?? "on-failure";
    if (mode === "on-failure" && exitCode === 0) {
      return false;
    }

    // Check max retries
    const maxRetries = policy?.maxRetries ?? 10;
    if (this.restartCount >= maxRetries) {
      logger.error("Max restarts exceeded", {
        name: this.config.name,
        restarts: this.restartCount,
        maxRetries,
      });
      this.emit(
        "error",
        new Error(`Max restarts (${maxRetries}) exceeded for ${this.config.name}`)
      );
      return false;
    }

    return true;
  }

  /**
   * Schedule a restart with backoff
   */
  private scheduleRestart(): void {
    const delay = this.calculateRestartDelay();
    this._status = "restarting";
    this.restartCount++;

    logger.info("Scheduling restart", {
      name: this.config.name,
      attempt: this.restartCount,
      delayMs: delay,
    });

    this.emit("restart", this.restartCount);

    this.restartTimer = setTimeout(() => {
      this.start().catch((err) => {
        logger.error("Restart failed", {
          name: this.config.name,
          error: err.message,
        });
        this.emit("error", err);
      });
    }, delay);
  }

  /**
   * Calculate restart delay with backoff
   */
  private calculateRestartDelay(): number {
    const policy = this.config.restart;
    const baseDelay = policy?.delay ?? 1000;
    const backoff = policy?.backoff ?? "exponential";
    const maxDelay = policy?.maxDelay ?? 60000;

    let delay: number;
    if (backoff === "linear") {
      delay = baseDelay * this.restartCount;
    } else {
      delay = baseDelay * Math.pow(2, this.restartCount - 1);
    }

    return Math.min(delay, maxDelay);
  }

  /**
   * Check if a process is still alive
   *
   * @param pid - Process ID to check
   * @returns true if process exists, false otherwise
   */
  private isProcessAlive(pid: number): boolean {
    try {
      // Signal 0 doesn't kill the process, just checks if it exists
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Force cleanup when streams don't close properly
   * This is a last resort to prevent hangs
   */
  private forceExitCleanup(): void {
    // Manually trigger exit logic even if streams haven't closed
    const code = this.exitInfo?.code ?? -1;
    const signal = this.exitInfo?.signal ?? null;

    this._status = code === 0 ? "stopped" : "crashed";

    logger.warn("Force cleanup - emitting exit without waiting for streams", {
      name: this.config.name,
      code,
      signal,
      stdoutClosed: this.stdoutClosed,
      stderrClosed: this.stderrClosed,
    });

    // Emit exit with whatever logs we have
    const logs: ExitLogs = {
      stdout: [...this.pendingStdout],
      stderr: [...this.pendingStderr],
    };

    this.emit("exit", code, signal, logs);

    // Clear buffers
    this.resetBuffers();
  }

  /**
   * Reset internal buffers
   */
  private resetBuffers(): void {
    this.pendingStdout = [];
    this.pendingStderr = [];
    this.stdoutClosed = false;
    this.stderrClosed = false;
    this.exitInfo = undefined;
  }
}
