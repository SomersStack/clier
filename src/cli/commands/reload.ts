/**
 * Reload Command
 *
 * Reloads the daemon configuration without fully stopping it.
 * Validates the new configuration first, then hot-reloads the daemon.
 */

import ora from "ora";
import { ZodError } from "zod";
import { loadConfig } from "../../config/loader.js";
import { getDaemonClient } from "../../daemon/client.js";
import { resolveConfigPath } from "../../utils/project-root.js";
import {
  printError,
  printSuccess,
  printWarning,
  formatValidationErrors,
} from "../utils/formatter.js";

/**
 * Options for reload command
 */
export interface ReloadOptions {
  /** Re-start services that were manually started via 'clier service start' */
  restartManualServices?: boolean;
}

/**
 * Reload the Clier configuration
 *
 * Automatically searches upward for clier-pipeline.json if not explicitly provided.
 *
 * @param configPath - Path to configuration file (optional, auto-detected if not provided)
 * @param options - Optional reload options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function reloadCommand(
  configPath?: string,
  options?: ReloadOptions
): Promise<number> {
  const spinner = ora();

  try {
    // Step 1: Resolve config path (searches upward if needed)
    spinner.start("Locating configuration...");
    let configFile: string;

    try {
      configFile = resolveConfigPath(configPath);
      spinner.succeed("Configuration found");
    } catch (error) {
      spinner.fail("Configuration not found");
      printError(error instanceof Error ? error.message : String(error));
      return 1;
    }

    // Step 2: Load and validate new configuration
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

    // Step 3: Connect to daemon (auto-detects project root)
    const client = await getDaemonClient();

    // Step 4: Reload daemon
    spinner.start("Reloading daemon...");
    try {
      if (options?.restartManualServices) {
        // Use clearReload to also restart manually started services
        const result = await client.request("config.clearReload", {
          configPath: configFile,
          restartManualServices: true,
        }) as { success: boolean; restartedServices: string[] };
        spinner.succeed("Daemon reloaded");
        client.disconnect();

        console.log();
        printSuccess("Configuration reloaded successfully");

        if (result.restartedServices.length > 0) {
          console.log();
          console.log("  Restarted manual services:");
          for (const service of result.restartedServices) {
            console.log(`    - ${service}`);
          }
        }
      } else {
        await client.request("config.reload", { configPath: configFile });
        spinner.succeed("Daemon reloaded");
        client.disconnect();

        console.log();
        printSuccess("Configuration reloaded successfully");
      }
      console.log();
    } catch (error) {
      spinner.fail("Failed to reload daemon");
      printError(error instanceof Error ? error.message : String(error));
      client.disconnect();
      return 1;
    }

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
