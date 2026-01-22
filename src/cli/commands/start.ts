/**
 * Start Command
 *
 * Starts the Clier pipeline by:
 * 1. Loading and validating configuration
 * 2. Starting the daemon in the background
 */

import path from "path";
import { mkdir } from "fs/promises";
import ora from "ora";
import { ZodError } from "zod";
import { loadConfig } from "../../config/loader.js";
import { Daemon } from "../../daemon/index.js";
import { getDaemonClient } from "../../daemon/client.js";
import {
  printError,
  printSuccess,
  printWarning,
  formatValidationErrors,
  printHeader,
  formatUptime,
} from "../utils/formatter.js";

/**
 * Start the Clier pipeline
 *
 * @param configPath - Path to configuration file (optional, defaults to clier-pipeline.json in cwd)
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function startCommand(configPath?: string): Promise<number> {
  const configFile =
    configPath || path.join(process.cwd(), "clier-pipeline.json");
  const spinner = ora();

  try {
    // Step 1: Load and validate configuration
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

    // Step 2: Check if daemon already running
    const client = await getDaemonClient().catch(() => null);
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

    // Step 3: Ensure daemon directory exists
    const daemonDir = path.join(process.cwd(), ".clier");
    await mkdir(daemonDir, { recursive: true });

    // Step 4: Start daemon
    spinner.start("Starting daemon...");
    const daemon = new Daemon({
      configPath: configFile,
      projectRoot: process.cwd(),
      detached: true,
    });

    try {
      await daemon.start();
    } catch (error) {
      spinner.fail("Failed to start daemon");
      printError(error instanceof Error ? error.message : String(error));
      return 1;
    }

    // Wait for daemon to be ready
    await waitForDaemon(2000);

    spinner.succeed("Daemon started");

    console.log();
    printSuccess("Clier pipeline running in background");
    console.log();
    console.log("  Commands:");
    console.log("    clier status    - View process status");
    console.log("    clier logs      - View process logs");
    console.log("    clier stop      - Stop the daemon");
    console.log();

    return 0;
  } catch (error) {
    spinner.fail("Failed to start daemon");
    printError(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}

/**
 * Wait for daemon to be ready
 */
async function waitForDaemon(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const client = await getDaemonClient();
      await client.request("ping");
      client.disconnect();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Daemon did not become ready in time");
}
