/**
 * Reload Command
 *
 * Reloads the daemon configuration without fully stopping it.
 * Validates the new configuration first, then hot-reloads the daemon.
 */

import path from "path";
import ora from "ora";
import { ZodError } from "zod";
import { loadConfig } from "../../config/loader.js";
import { getDaemonClient } from "../../daemon/client.js";
import {
  printError,
  printSuccess,
  printWarning,
  formatValidationErrors,
} from "../utils/formatter.js";

/**
 * Reload the Clier configuration
 *
 * @param configPath - Path to configuration file (optional, defaults to clier-pipeline.json in cwd)
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function reloadCommand(configPath?: string): Promise<number> {
  const configFile =
    configPath || path.join(process.cwd(), "clier-pipeline.json");
  const spinner = ora();

  try {
    // Step 1: Load and validate new configuration
    spinner.start("Validating configuration...");
    try {
      await loadConfig(configFile);
      spinner.succeed("Configuration is valid");
    } catch (error) {
      spinner.fail("Invalid configuration");
      if (error instanceof ZodError) {
        console.error(formatValidationErrors(error));
      } else {
        printError(error instanceof Error ? error.message : String(error));
      }
      return 1;
    }

    // Step 2: Connect to daemon
    const client = await getDaemonClient();

    // Step 3: Reload daemon
    spinner.start("Reloading daemon...");
    try {
      await client.request("config.reload", { configPath: configFile });
      spinner.succeed("Daemon reloaded");
      client.disconnect();
    } catch (error) {
      spinner.fail("Failed to reload daemon");
      printError(error instanceof Error ? error.message : String(error));
      client.disconnect();
      return 1;
    }

    console.log();
    printSuccess("Configuration reloaded successfully");
    console.log();

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

    spinner.fail("Failed to reload configuration");
    printError(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}
