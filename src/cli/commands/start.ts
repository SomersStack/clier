/**
 * Start Command
 *
 * Starts the Clier pipeline by:
 * 1. Loading and validating configuration
 * 2. Starting the daemon in the background
 */

import path from "path";
import { mkdir, readFile, unlink } from "fs/promises";
import ora from "ora";
import { ZodError } from "zod";
import { loadConfig } from "../../config/loader.js";
import { Daemon } from "../../daemon/index.js";
import { getDaemonClient } from "../../daemon/client.js";
import { resolveConfigPath } from "../../utils/project-root.js";
import {
  printError,
  printSuccess,
  printWarning,
  formatValidationErrors,
  printHeader,
  formatUptime,
} from "../utils/formatter.js";

/**
 * Start command options
 */
export interface StartOptions {
  paused?: boolean;
}

/**
 * Start the Clier pipeline
 *
 * Automatically searches upward for clier-pipeline.json if not explicitly provided.
 *
 * @param configPath - Path to configuration file (optional, auto-detected if not provided)
 * @param options - Start options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function startCommand(
  configPath?: string,
  options: StartOptions = {},
): Promise<number> {
  const spinner = ora();

  try {
    // Step 1: Resolve config path (searches upward if needed)
    spinner.start("Locating configuration...");
    let configFile: string;
    let projectRoot: string;

    try {
      configFile = resolveConfigPath(configPath);
      projectRoot = path.dirname(configFile);
      spinner.succeed(`Configuration found at ${configFile}`);
    } catch (error) {
      spinner.fail("Configuration not found");
      printError(error instanceof Error ? error.message : String(error));
      return 1;
    }

    // Step 2: Load and validate configuration
    spinner.start("Loading configuration...");
    let config;
    try {
      config = await loadConfig(configFile);
      spinner.succeed("Configuration loaded");
    } catch (error) {
      spinner.fail("Failed to load configuration");
      if (error instanceof ZodError) {
        console.error(formatValidationErrors(error));
      } else {
        printError(error instanceof Error ? error.message : String(error));
      }
      return 1;
    }

    printHeader(config.project_name);

    // Step 3: Check if daemon already running
    const client = await getDaemonClient(projectRoot).catch(() => null);
    if (client) {
      try {
        const status = await client.request("daemon.status");
        client.disconnect();

        printWarning("Clier daemon already running");
        console.log();
        console.log(`  PID: ${status.pid}`);
        console.log(`  Uptime: ${formatUptime(status.uptime)}`);
        console.log(`  Processes: ${status.processCount}`);
        console.log();
        console.log('  Run "clier stop" to stop it');
        return 1;
      } catch (error) {
        // Daemon might be dead, continue
        client.disconnect();
      }
    }

    // Step 4: Ensure daemon directory exists
    const daemonDir = path.join(projectRoot, ".clier");
    await mkdir(daemonDir, { recursive: true });

    // Step 5: Start daemon
    spinner.start(
      options.paused
        ? "Starting daemon (paused - no auto-start)..."
        : "Starting daemon...",
    );
    const daemon = new Daemon({
      configPath: configFile,
      projectRoot: projectRoot,
      detached: true,
      paused: options.paused,
    });

    try {
      await daemon.start();
    } catch (error) {
      spinner.fail("Failed to start daemon");
      printError(error instanceof Error ? error.message : String(error));
      return 1;
    }

    // Wait for daemon to be ready
    await waitForDaemon(2000, projectRoot);

    spinner.succeed("Daemon started");

    // Check for recovery state from a previous unclean shutdown
    await checkRecoveryState(projectRoot);

    console.log();
    if (options.paused) {
      printSuccess("Clier daemon running in background (paused)");
      console.log();
      console.log("  No processes were auto-started.");
      console.log();
      console.log("  Commands:");
      console.log("    clier run <name> - Start an individual process");
      console.log("    clier status     - View process status");
      console.log("    clier stop       - Stop the daemon");
    } else {
      printSuccess("Clier pipeline running in background");
      console.log();
      console.log("  Commands:");
      console.log("    clier status    - View process status");
      console.log("    clier logs      - View process logs");
      console.log("    clier stop      - Stop the daemon");
    }
    console.log();

    return 0;
  } catch (error) {
    spinner.fail("Failed to start daemon");
    printError(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

/**
 * Wait for daemon to be ready
 */
async function waitForDaemon(
  timeoutMs: number,
  projectRoot: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const client = await getDaemonClient(projectRoot);
      await client.request("ping");
      client.disconnect();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Daemon did not become ready in time");
}

/**
 * Check for daemon state file from a previous unclean shutdown
 */
async function checkRecoveryState(projectRoot: string): Promise<void> {
  const statePath = path.join(projectRoot, ".clier", "daemon-state.json");

  try {
    const content = await readFile(statePath, "utf-8");
    const state = JSON.parse(content);

    if (state.runningProcesses?.length > 0) {
      printWarning("Previous daemon did not shut down cleanly");
      console.log(`  PID: ${state.pid}`);
      console.log(
        `  Processes that were running: ${state.runningProcesses.join(", ")}`,
      );
      console.log();
    }

    // Remove the state file now that we've warned the user
    await unlink(statePath);
  } catch {
    // No state file or invalid — nothing to report
  }
}
