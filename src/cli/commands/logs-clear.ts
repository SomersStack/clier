/**
 * Logs Clear Command
 *
 * Clears logs for processes and/or daemon.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import { printError, printSuccess, printWarning } from "../utils/formatter.js";

export interface LogsClearOptions {
  /** Clear daemon logs instead of process logs */
  daemon?: boolean;
  /** Log level for daemon logs (combined, error, or all) */
  level?: "combined" | "error" | "all";
  /** Clear all process logs (when no name specified) */
  all?: boolean;
}

/**
 * Clear logs for a specific process, all processes, or daemon
 *
 * @param processName - Name of the process (optional)
 * @param options - Clear options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function logsClearCommand(
  processName: string,
  options: LogsClearOptions = {}
): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Handle daemon logs
    if (options.daemon) {
      console.log(chalk.cyan("\nClearing daemon logs..."));

      const result: { success: true; cleared: string[] } = await client.request(
        "daemon.logs.clear",
        {
          level: options.level || "all",
        }
      );

      client.disconnect();

      if (result.cleared.length === 0) {
        printWarning("No daemon logs to clear");
      } else {
        printSuccess(`Cleared daemon logs: ${result.cleared.join(", ")}`);
      }

      console.log();
      return 0;
    }

    // Handle process logs
    if (!processName && !options.all) {
      printError("Process name required. Use --all to clear all process logs.");
      console.log();
      console.log("Usage:");
      console.log("  clier logs clear <name>     Clear logs for a specific process");
      console.log("  clier logs clear --all      Clear logs for all processes");
      console.log("  clier logs clear --daemon   Clear daemon logs");
      console.log();
      client.disconnect();
      return 1;
    }

    console.log(
      chalk.cyan(
        `\nClearing logs for: ${processName || "all processes"}...`
      )
    );

    const result: { success: true; cleared: string[] } = await client.request(
      "logs.clear",
      {
        name: processName || undefined,
      }
    );

    client.disconnect();

    if (result.cleared.length === 0) {
      printWarning("No logs to clear");
    } else {
      printSuccess(`Cleared logs for: ${result.cleared.join(", ")}`);
    }

    console.log();
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
