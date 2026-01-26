/**
 * Status Command
 *
 * Shows the status of the daemon and all running processes.
 * Queries the daemon via IPC to get real-time process status.
 */

import chalk from "chalk";
import Table from "cli-table3";
import { getDaemonClient } from "../../daemon/client.js";
import type { ProcessStatus } from "../../core/process-manager.js";
import type { DaemonStatus } from "../../daemon/controller.js";
import {
  printWarning,
  printError,
  formatUptime,
  formatStatus,
} from "../utils/formatter.js";

export interface StatusOptions {
  watch?: boolean;
  interval?: number;
}

/**
 * Build status output and return as string with line count
 */
function buildStatusOutput(
  daemonStatus: DaemonStatus,
  processes: ProcessStatus[],
  isWatch: boolean
): { output: string; lineCount: number } {
  const lines: string[] = [];

  // Display daemon status
  lines.push("");
  lines.push(chalk.bold("Daemon Status"));
  lines.push(chalk.gray("─────────────────"));
  lines.push(`  PID:      ${daemonStatus.pid}`);
  lines.push(`  Uptime:   ${formatUptime(daemonStatus.uptime)}`);
  lines.push(`  Config:   ${daemonStatus.configPath}`);
  lines.push("");

  // Display process status
  lines.push(chalk.bold("Processes"));
  lines.push(chalk.gray("─────────────────"));

  if (processes.length === 0) {
    lines.push(chalk.gray("  No processes running"));
  } else {
    const table = new Table({
      head: [
        chalk.white("Name"),
        chalk.white("Status"),
        chalk.white("PID"),
        chalk.white("Uptime"),
        chalk.white("Restarts"),
      ],
      style: {
        head: [],
        border: [],
      },
    });

    for (const proc of processes) {
      table.push([
        proc.name,
        formatStatus(proc.status),
        proc.pid?.toString() || "-",
        formatUptime(proc.uptime),
        proc.restarts.toString(),
      ]);
    }

    // Table output can contain multiple lines
    const tableOutput = table.toString();
    lines.push(...tableOutput.split("\n"));
  }

  lines.push("");

  if (isWatch) {
    lines.push(chalk.gray("Press Ctrl+C to exit watch mode"));
  }

  return { output: lines.join("\n"), lineCount: lines.length };
}

/**
 * Render status output to console
 */
function renderStatus(
  daemonStatus: DaemonStatus,
  processes: ProcessStatus[],
  isWatch: boolean
): number {
  const { output, lineCount } = buildStatusOutput(daemonStatus, processes, isWatch);
  console.log(output);
  return lineCount;
}

/**
 * Fetch status from daemon
 */
async function fetchStatus(): Promise<{
  daemonStatus: DaemonStatus;
  processes: ProcessStatus[];
}> {
  const client = await getDaemonClient();
  const daemonStatus: DaemonStatus = await client.request("daemon.status");
  const processes: ProcessStatus[] = await client.request("process.list");
  client.disconnect();
  return { daemonStatus, processes };
}

/**
 * Move cursor up and clear to end of screen
 */
function clearPreviousOutput(lineCount: number): void {
  if (lineCount > 0) {
    // Move cursor up N lines, then clear from cursor to end of screen
    process.stdout.write(`\x1B[${lineCount}A\x1B[J`);
  }
}

/**
 * Show status of daemon and all processes
 *
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function statusCommand(
  options: StatusOptions = {}
): Promise<number> {
  const { watch = false, interval = 2 } = options;

  try {
    if (watch) {
      // Watch mode - continuously update
      let running = true;
      let lastLineCount = 0;

      // Handle Ctrl+C gracefully
      const cleanup = () => {
        running = false;
        console.log();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      while (running) {
        try {
          clearPreviousOutput(lastLineCount);
          const { daemonStatus, processes } = await fetchStatus();
          lastLineCount = renderStatus(daemonStatus, processes, true);
        } catch (error) {
          clearPreviousOutput(lastLineCount);
          if (
            error instanceof Error &&
            error.message.includes("not running")
          ) {
            const errorLines = [
              "",
              chalk.yellow("⚠ Clier daemon is not running"),
              "",
              "  Start it with: clier start",
              "",
              chalk.gray("Waiting for daemon to start..."),
              chalk.gray("Press Ctrl+C to exit watch mode"),
            ];
            console.log(errorLines.join("\n"));
            lastLineCount = errorLines.length;
          } else {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(chalk.red(`✖ ${errorMsg}`));
            lastLineCount = 1;
          }
        }

        // Wait for the interval
        await new Promise((resolve) =>
          setTimeout(resolve, interval * 1000)
        );
      }

      return 0;
    } else {
      // Single status check
      const { daemonStatus, processes } = await fetchStatus();
      renderStatus(daemonStatus, processes, false);
      return 0;
    }
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
