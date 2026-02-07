/**
 * Events Command
 *
 * Shows event history by querying the daemon.
 * Supports filtering by process name, event type, event name, and time.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import type { ClierEvent } from "../../types/events.js";
import { printError, printWarning } from "../utils/formatter.js";

export interface EventsOptions {
  /** Filter by process/service name */
  process?: string;
  /** Filter by event type (success, error, crashed, custom, stdout, stderr) */
  type?: "success" | "error" | "crashed" | "custom" | "stdout" | "stderr";
  /** Filter by event name (partial match) */
  name?: string;
  /** Number of events to show (default: 100) */
  lines?: number;
  /** Show events since duration (e.g., "5m", "1h", "30s") */
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
 * Get color for event type
 */
function getTypeColor(type: ClierEvent["type"]): (text: string) => string {
  switch (type) {
    case "success":
      return chalk.green;
    case "error":
      return chalk.red;
    case "crashed":
      return chalk.bgRed.white;
    case "custom":
      return chalk.cyan;
    case "stdout":
      return chalk.gray;
    case "stderr":
      return chalk.yellow;
    default:
      return chalk.white;
  }
}

/**
 * Format event data for display
 */
function formatEventData(data: ClierEvent["data"]): string {
  if (data === undefined) {
    return "";
  }
  if (typeof data === "string") {
    // Truncate long strings
    const maxLen = 80;
    if (data.length > maxLen) {
      return data.substring(0, maxLen) + "...";
    }
    return data;
  }
  if (typeof data === "number") {
    return String(data);
  }
  // Object - stringify it
  try {
    const json = JSON.stringify(data);
    const maxLen = 80;
    if (json.length > maxLen) {
      return json.substring(0, maxLen) + "...";
    }
    return json;
  } catch {
    return "[object]";
  }
}

/**
 * Show event history
 *
 * @param options - Events options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function eventsCommand(
  options: EventsOptions = {},
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

    // Query events from daemon
    const events: ClierEvent[] = await client.request("events.query", {
      processName: options.process,
      eventType: options.type,
      eventName: options.name,
      lines: options.lines,
      since: sinceTimestamp,
    });

    client.disconnect();

    // Display header
    console.log(chalk.cyan("\nEvent History"));
    console.log(chalk.gray("─".repeat(80)));

    // Show active filters
    const filters: string[] = [];
    if (options.process) filters.push(`process=${options.process}`);
    if (options.type) filters.push(`type=${options.type}`);
    if (options.name) filters.push(`name=${options.name}`);
    if (options.since) filters.push(`since=${options.since}`);

    if (filters.length > 0) {
      console.log(chalk.gray(`Filters: ${filters.join(", ")}`));
    }
    console.log(
      chalk.gray(
        `Showing ${events.length} events (max ${options.lines || 100})`,
      ),
    );
    console.log();

    // Display events
    if (events.length === 0) {
      printWarning("No events found");
      console.log();
      console.log(
        "  Events are stored in-memory and cleared on daemon restart.",
      );
      console.log("  Up to 100 recent events are kept.");
      console.log();
      return 0;
    }

    // Table header
    console.log(
      chalk.bold(
        `${"TIMESTAMP".padEnd(24)} ${"PROCESS".padEnd(15)} ${"TYPE".padEnd(10)} ${"EVENT".padEnd(25)} DATA`,
      ),
    );
    console.log(chalk.gray("─".repeat(80)));

    for (const event of events) {
      const timestamp = new Date(event.timestamp)
        .toISOString()
        .replace("T", " ")
        .substring(0, 23);
      const process = event.processName.substring(0, 14).padEnd(15);
      const typeColor = getTypeColor(event.type);
      const type = typeColor(event.type.toUpperCase().padEnd(10));
      const name = event.name.substring(0, 24).padEnd(25);
      const data = formatEventData(event.data);

      console.log(
        `${chalk.gray(timestamp)} ${chalk.blue(process)} ${type} ${chalk.white(name)} ${chalk.gray(data)}`,
      );
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
