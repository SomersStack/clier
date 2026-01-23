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
  /** Show daemon logs instead of process logs */
  daemon?: boolean;
  /** Log level for daemon logs (combined or error) */
  level?: "combined" | "error";
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
 * Show logs for a specific process or daemon
 *
 * @param processName - Name of the process (ignored if --daemon is used)
 * @param options - Logs options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function logsCommand(
  processName: string,
  options: LogsOptions = {}
): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Handle daemon logs
    if (options.daemon) {
      const logLines: string[] = await client.request("daemon.logs", {
        lines: options.lines,
        level: options.level || "combined",
      });

      client.disconnect();

      // Display header
      const logType = options.level === "error" ? "Error Logs" : "Combined Logs";
      console.log(chalk.cyan(`\nDaemon ${logType}`));
      console.log(chalk.gray("─".repeat(50)));
      console.log(chalk.gray(`Showing last ${options.lines || 100} lines`));
      console.log();

      // Display logs
      if (logLines.length === 0) {
        printWarning("No daemon logs found");
        return 0;
      }

      for (const line of logLines) {
        // Parse JSON log line
        try {
          const log = JSON.parse(line);
          const timestamp = log.timestamp || new Date().toISOString();
          const level = log.level || "info";
          const message = log.message || line;
          const context = log.context ? chalk.blue(`[${log.context}]`) : "";

          // Colorize level
          let levelColor;
          switch (level) {
            case "error":
              levelColor = chalk.red(level.toUpperCase());
              break;
            case "warn":
              levelColor = chalk.yellow(level.toUpperCase());
              break;
            case "info":
              levelColor = chalk.green(level.toUpperCase());
              break;
            case "debug":
              levelColor = chalk.gray(level.toUpperCase());
              break;
            default:
              levelColor = level.toUpperCase();
          }

          console.log(
            `${chalk.gray(timestamp)} ${levelColor} ${context} ${message}`
          );

          // Show stack trace if available
          if (log.stack) {
            console.log(chalk.gray(log.stack));
          }
        } catch {
          // If not JSON, just print the line
          console.log(line);
        }
      }

      console.log();
      return 0;
    }

    // Handle process logs (original behavior)
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
      console.log(chalk.gray(`Showing last ${options.lines || 100} lines`));
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
