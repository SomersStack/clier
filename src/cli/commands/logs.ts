/**
 * Logs Command
 *
 * Shows logs for a specific process by querying the daemon.
 * Supports snapshot queries: last N lines or since a timestamp.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import type { LogEntry } from "../../core/log-manager.js";
import { printError, printWarning } from "../utils/formatter.js";

export interface LogsOptions {
  /** Number of lines to show (default: 100) */
  lines?: number;
  /** Show logs since duration (e.g., "5m", "1h", "30s") */
  since?: string;
}

/**
 * Parse duration string to milliseconds
 * Supports: 30s, 5m, 1h, 2d
 */
function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match || !match[1] || !match[2]) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    case "d":
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Show logs for a specific process
 *
 * @param processName - Name of the process
 * @param options - Logs options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function logsCommand(
  processName: string,
  options: LogsOptions = {}
): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Parse since duration if provided
    let sinceTimestamp: number | undefined;
    if (options.since) {
      const sinceMs = parseDuration(options.since);
      if (sinceMs === null) {
        printError(`Invalid duration format: ${options.since}`);
        console.log();
        console.log("  Supported formats: 30s, 5m, 1h, 2d");
        console.log();
        client.disconnect();
        return 1;
      }
      sinceTimestamp = Date.now() - sinceMs;
    }

    // Query logs from daemon
    const logs: LogEntry[] = await client.request("logs.query", {
      name: processName,
      lines: options.lines,
      since: sinceTimestamp,
    });

    client.disconnect();

    // Display header
    console.log(chalk.cyan(`\nLogs for: ${processName}`));
    console.log(chalk.gray("─".repeat(50)));

    if (options.since) {
      console.log(chalk.gray(`Showing logs from the last ${options.since}`));
    } else {
      console.log(
        chalk.gray(`Showing last ${options.lines || 100} lines`)
      );
    }
    console.log();

    // Display logs
    if (logs.length === 0) {
      printWarning(`No logs found for process: ${processName}`);
      return 0;
    }

    for (const entry of logs) {
      const timestamp = new Date(entry.timestamp).toISOString();
      const stream =
        entry.stream === "stderr" ? chalk.red("[ERR]") : chalk.gray("[OUT]");
      console.log(`${chalk.gray(timestamp)} ${stream} ${entry.data}`);
    }

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

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
