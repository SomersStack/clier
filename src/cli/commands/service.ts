/**
 * Service Command
 *
 * Controls individual services (start, stop, restart, add, remove) by communicating with the daemon.
 * Allows fine-grained control of specific processes within a running pipeline.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import { printError, printSuccess, printWarning } from "../utils/formatter.js";
import type { ProcessConfig } from "../../core/managed-process.js";

/**
 * Service operation type
 */
export type ServiceOperation = "start" | "stop" | "restart" | "add" | "remove";

/**
 * Options for adding a service
 */
export interface AddServiceOptions {
  /** Command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Process type (default: service) */
  type?: "service" | "task";
  /** Environment variables in KEY=VALUE format */
  env?: string[];
  /** Auto-restart enabled (default: true for services) */
  restart?: boolean;
}

/**
 * Start a specific service
 *
 * @param serviceName - Name of the service to start
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function serviceStartCommand(
  serviceName: string
): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nStarting service: ${serviceName}`));

    await client.request("process.start", { name: serviceName });

    printSuccess(`Service "${serviceName}" started successfully`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not running")
    ) {
      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Stop a specific service
 *
 * @param serviceName - Name of the service to stop
 * @param force - If true, use SIGKILL instead of graceful shutdown
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function serviceStopCommand(
  serviceName: string,
  force = false
): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(
      chalk.cyan(
        `\nStopping service: ${serviceName}${force ? " (force)" : ""}`
      )
    );

    await client.request("process.stop", { name: serviceName, force });

    printSuccess(`Service "${serviceName}" stopped successfully`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Restart a specific service
 *
 * @param serviceName - Name of the service to restart
 * @param force - If true, use SIGKILL for the stop phase
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function serviceRestartCommand(
  serviceName: string,
  force = false
): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(
      chalk.cyan(
        `\nRestarting service: ${serviceName}${force ? " (force)" : ""}`
      )
    );

    await client.request("process.restart", { name: serviceName, force });

    printSuccess(`Service "${serviceName}" restarted successfully`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Add a new service to the running pipeline
 *
 * @param serviceName - Name of the new service
 * @param options - Service configuration options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function serviceAddCommand(
  serviceName: string,
  options: AddServiceOptions
): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Parse environment variables from KEY=VALUE format
    const env: Record<string, string> = {};
    if (options.env) {
      for (const envVar of options.env) {
        const [key, ...valueParts] = envVar.split("=");
        if (!key || valueParts.length === 0) {
          printError(`Invalid environment variable format: ${envVar}`);
          console.log();
          console.log("  Use: KEY=VALUE");
          console.log();
          client.disconnect();
          return 1;
        }
        env[key] = valueParts.join("=");
      }
    }

    // Build process config
    const config: ProcessConfig = {
      name: serviceName,
      command: options.command,
      type: options.type || "service",
      cwd: options.cwd,
      env: Object.keys(env).length > 0 ? env : undefined,
      restart:
        options.restart !== undefined
          ? { enabled: options.restart }
          : undefined,
    };

    console.log(chalk.cyan(`\nAdding service: ${serviceName}`));
    console.log(chalk.gray(`  Command: ${options.command}`));
    if (options.cwd) {
      console.log(chalk.gray(`  Working directory: ${options.cwd}`));
    }
    console.log(chalk.gray(`  Type: ${config.type}`));
    console.log();

    await client.request("process.add", { config });

    printSuccess(`Service "${serviceName}" added and started successfully`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not running")
    ) {
      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Remove a service from the running pipeline
 *
 * @param serviceName - Name of the service to remove
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function serviceRemoveCommand(
  serviceName: string
): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nRemoving service: ${serviceName}`));

    await client.request("process.delete", { name: serviceName });

    printSuccess(`Service "${serviceName}" removed successfully`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not running")
    ) {
      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
