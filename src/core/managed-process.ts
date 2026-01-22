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
      uptime: this.lastStartTime ? Date.now() - this.lastStartTime : 0,
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
      this.child = spawn(this.config.command, [], {
        cwd: this.config.cwd || process.cwd(),
        env: { ...process.env, ...this.config.env },
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
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
   */
  async stop(
    signal: NodeJS.Signals = "SIGTERM",
    timeout = 5000
  ): Promise<void> {
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

    logger.info("Stopping process", {
      name: this.config.name,
      signal,
      pid: this.child.pid,
    });

    return new Promise((resolve) => {
      const forceKillTimer = setTimeout(() => {
        if (this.child && this._status === "running") {
          logger.warn("Force killing process", {
            name: this.config.name,
            pid: this.child.pid,
          });
          this.child.kill("SIGKILL");
        }
      }, timeout);

      const cleanup = () => {
        clearTimeout(forceKillTimer);
        resolve();
      };

      // Listen for exit
      this.once("exit", cleanup);

      // Send signal
      this.child!.kill(signal);
    });
  }

  /**
   * Restart the process
   */
  async restart(): Promise<void> {
    await this.stop();
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
  private shouldAutoRestart(_exitCode: number | null): boolean {
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
