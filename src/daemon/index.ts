/**
 * Daemon Process
 *
 * Main daemon entry point that runs detached from terminal.
 * Manages the Watcher and IPC server lifecycle.
 */

import { fork } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DaemonServer } from "./server.js";
import { probeSocket } from "./utils.js";
import { Watcher } from "../watcher.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("Daemon");

const SHUTDOWN_TIMEOUT_MS = 15000;
const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEAP_WARNING_MB = 512;

/**
 * Daemon state saved before shutdown for crash recovery
 */
export interface DaemonState {
  savedAt: number;
  pid: number;
  runningProcesses: string[];
}

/**
 * Daemon options
 */
export interface DaemonOptions {
  configPath: string;
  projectRoot: string;
  detached: boolean;
  /** Start daemon without auto-starting any entry points */
  paused?: boolean;
}

/**
 * Daemon class
 *
 * Manages the lifecycle of the daemon process:
 * - Spawns detached background process
 * - Manages PID and socket files
 * - Runs Watcher and IPC server
 * - Handles graceful shutdown
 */
export class Daemon {
  private server?: DaemonServer;
  private watcher?: Watcher;
  private healthCheckInterval?: ReturnType<typeof setInterval>;

  constructor(private options: DaemonOptions) {}

  /**
   * Start the daemon
   *
   * If detached=true, spawns a detached child process and returns.
   * If detached=false, runs as the daemon process (blocking).
   */
  async start(): Promise<void> {
    // Setup daemon directory structure
    await this.ensureDaemonDir();

    // If detached mode, spawn detached process and exit
    if (this.options.detached) {
      // Check if daemon already running (only in parent)
      if (await this.isDaemonRunning()) {
        throw new Error("Daemon already running");
      }

      // Clean up stale socket files from previous crashed daemons
      await this.cleanStaleFiles();

      this.spawnDetached();
      return; // Parent exits, child continues
    }

    // We're in the detached child process now - don't check if running
    await this.runAsDaemon();
  }

  /**
   * Clean up stale socket files from previous crashed daemons.
   *
   * Called after isDaemonRunning() returns false, meaning the PID file
   * is gone or the process is dead. Probes the socket to confirm it's
   * not owned by a live daemon whose PID file was deleted.
   */
  private async cleanStaleFiles(): Promise<void> {
    const socketPath = this.getSocketPath();

    if (!fs.existsSync(socketPath)) {
      return;
    }

    const isAlive = await probeSocket(socketPath, 500);

    if (isAlive) {
      throw new Error(
        "A daemon appears to be running without a PID file. " +
          'Run "clier stop" to shut it down first.',
      );
    }

    // Socket is stale — safe to remove
    try {
      fs.unlinkSync(socketPath);
      logger.info("Cleaned up stale socket file", { socketPath });
    } catch (error) {
      logger.warn("Failed to clean up stale socket file", {
        socketPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Spawn a detached child process
   */
  private spawnDetached(): void {
    const daemonDir = this.getDaemonDir();
    const logPath = path.join(daemonDir, "daemon.log");

    // Open log file
    const logFd = fs.openSync(logPath, "a");

    // Get the path to this module's compiled JS file
    // We need to spawn the watcher-entry which will run in daemon mode
    const entryPoint = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "../watcher-entry.js",
    );

    // Spawn detached child process
    const child = fork(entryPoint, [], {
      detached: true,
      stdio: ["ignore", logFd, logFd, "ipc"],
      env: {
        ...process.env,
        CLIER_DAEMON_MODE: "1",
        CLIER_CONFIG_PATH: this.options.configPath,
        CLIER_PROJECT_ROOT: this.options.projectRoot,
        ...(this.options.paused ? { CLIER_START_PAUSED: "1" } : {}),
      },
    });

    // Write PID
    const pidPath = path.join(daemonDir, "daemon.pid");
    fs.writeFileSync(pidPath, child.pid!.toString());

    // Detach from parent
    child.unref();

    logger.info("Daemon started", { pid: child.pid });
  }

  /**
   * Run as the daemon process (blocking)
   */
  private async runAsDaemon(): Promise<void> {
    logger.info("Running as daemon", { pid: process.pid });

    // Setup signal handlers
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));
    process.on("SIGINT", () => this.shutdown("SIGINT"));

    try {
      // Start watcher (daemon handles signals, so disable watcher's own signal handlers)
      this.watcher = new Watcher();
      const paused =
        this.options.paused || process.env.CLIER_START_PAUSED === "1";
      await this.watcher.start(
        this.options.configPath,
        this.options.projectRoot,
        {
          setupSignalHandlers: false,
          paused,
        },
      );

      // Start IPC server
      this.server = new DaemonServer(this.watcher);
      await this.server.start(this.getSocketPath());

      // Start health check watchdog
      this.startHealthCheck();

      logger.info("Daemon running", {
        socket: this.getSocketPath(),
        pid: process.pid,
      });
    } catch (error) {
      logger.error("Failed to start daemon", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Start periodic health check watchdog
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      const checks: Record<string, boolean> = {};

      // Check watcher exists
      checks.watcher = !!this.watcher;

      // Check process manager exists
      const pm = this.watcher?.getProcessManager();
      checks.processManager = !!pm;

      // Check memory usage
      const mem = process.memoryUsage();
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);

      if (heapUsedMB > HEAP_WARNING_MB) {
        logger.warn("High memory usage detected", {
          heapUsedMB,
          heapTotalMB,
          rssMB: Math.round(mem.rss / 1024 / 1024),
        });
      }

      const allHealthy = Object.values(checks).every(Boolean);
      if (!allHealthy) {
        logger.warn("Health check found issues", { checks });
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    // Don't let the interval prevent exit
    this.healthCheckInterval.unref();
  }

  /**
   * Shutdown the daemon gracefully
   */
  private async shutdown(signal: string): Promise<void> {
    logger.info("Shutting down daemon", { signal });

    try {
      // Save state before stopping processes
      await this.saveState();

      // Wrap cleanup in a hard timeout to prevent hanging forever
      await Promise.race([
        this.cleanup(),
        new Promise<void>((_, reject) =>
          setTimeout(
            () => reject(new Error("Shutdown timed out")),
            SHUTDOWN_TIMEOUT_MS,
          ),
        ),
      ]);

      // Clean shutdown — remove state file
      this.removeStateFile();
    } catch (error) {
      logger.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      process.exit(0);
    }
  }

  /**
   * Save daemon state for crash recovery
   */
  private async saveState(): Promise<void> {
    try {
      const pm = this.watcher?.getProcessManager();
      const runningProcesses = pm
        ? pm
            .listProcesses()
            .filter((p) => p.status === "running")
            .map((p) => p.name)
        : [];

      const state: DaemonState = {
        savedAt: Date.now(),
        pid: process.pid,
        runningProcesses,
      };

      const statePath = this.getStatePath();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      logger.debug("Daemon state saved", { statePath, runningProcesses });
    } catch (error) {
      logger.warn("Failed to save daemon state", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Cleanup daemon resources
   */
  private async cleanup(): Promise<void> {
    try {
      // Clear health check interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      // Stop IPC server
      await this.server?.stop();

      // Stop watcher
      await this.watcher?.stop();

      // Remove PID file
      this.removePidFile();

      // Remove socket file
      this.removeSocketFile();

      logger.info("Cleanup complete");
    } catch (error) {
      logger.error("Error during cleanup", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Ensure daemon directory exists
   */
  private async ensureDaemonDir(): Promise<void> {
    const dir = this.getDaemonDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      logger.error("Failed to create daemon directory", {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if daemon is already running
   */
  private async isDaemonRunning(): Promise<boolean> {
    const pidPath = path.join(this.getDaemonDir(), "daemon.pid");

    if (!fs.existsSync(pidPath)) {
      return false;
    }

    try {
      const pidStr = fs.readFileSync(pidPath, "utf-8");
      const pid = parseInt(pidStr.trim());

      // Check if process exists (signal 0 doesn't actually send a signal)
      process.kill(pid, 0);
      return true;
    } catch {
      // Process doesn't exist, remove stale PID file
      this.removePidFile();
      return false;
    }
  }

  /**
   * Remove PID file
   */
  private removePidFile(): void {
    const pidPath = path.join(this.getDaemonDir(), "daemon.pid");
    try {
      if (fs.existsSync(pidPath)) {
        fs.unlinkSync(pidPath);
      }
    } catch (error) {
      logger.error("Failed to remove PID file", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove socket file
   */
  private removeSocketFile(): void {
    const socketPath = this.getSocketPath();
    try {
      if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
      }
    } catch (error) {
      logger.error("Failed to remove socket file", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove state file
   */
  private removeStateFile(): void {
    const statePath = this.getStatePath();
    try {
      if (fs.existsSync(statePath)) {
        fs.unlinkSync(statePath);
      }
    } catch (error) {
      logger.warn("Failed to remove state file", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get daemon directory path
   */
  private getDaemonDir(): string {
    return path.join(this.options.projectRoot, ".clier");
  }

  /**
   * Get socket file path
   */
  private getSocketPath(): string {
    return path.join(this.getDaemonDir(), "daemon.sock");
  }

  /**
   * Get state file path
   */
  private getStatePath(): string {
    return path.join(this.getDaemonDir(), "daemon-state.json");
  }
}

/**
 * Start daemon if running in daemon mode
 *
 * This should be called from watcher-entry.ts when CLIER_DAEMON_MODE is set.
 */
export async function startDaemonMode(): Promise<void> {
  const configPath = process.env.CLIER_CONFIG_PATH;
  const projectRoot = process.env.CLIER_PROJECT_ROOT;

  if (!configPath || !projectRoot) {
    throw new Error("Missing CLIER_CONFIG_PATH or CLIER_PROJECT_ROOT");
  }

  const daemon = new Daemon({
    configPath,
    projectRoot,
    detached: false, // Already detached, just run
  });

  await daemon.start();
}
