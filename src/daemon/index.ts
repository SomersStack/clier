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
import { Watcher } from "../watcher.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("Daemon");

/**
 * Daemon options
 */
export interface DaemonOptions {
  configPath: string;
  projectRoot: string;
  detached: boolean;
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
      this.spawnDetached();
      return; // Parent exits, child continues
    }

    // We're in the detached child process now - don't check if running
    await this.runAsDaemon();
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
      "../watcher-entry.js"
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
      // Start watcher
      this.watcher = new Watcher();
      await this.watcher.start(this.options.configPath, this.options.projectRoot);

      // Start IPC server
      this.server = new DaemonServer(this.watcher);
      await this.server.start(this.getSocketPath());

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
   * Shutdown the daemon gracefully
   */
  private async shutdown(signal: string): Promise<void> {
    logger.info("Shutting down daemon", { signal });

    await this.cleanup();

    process.exit(0);
  }

  /**
   * Cleanup daemon resources
   */
  private async cleanup(): Promise<void> {
    try {
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
