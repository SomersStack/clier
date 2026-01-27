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
 * Enter alternate screen buffer (like vim, htop, less)
 */
function enterAlternateScreen(): void {
  process.stdout.write("\x1B[?1049h"); // Enter alternate screen
  process.stdout.write("\x1B[?25l"); // Hide cursor
}

/**
 * Exit alternate screen buffer and restore original terminal
 */
function exitAlternateScreen(): void {
  process.stdout.write("\x1B[?25h"); // Show cursor
  process.stdout.write("\x1B[?1049l"); // Exit alternate screen
}

/**
 * Clear screen and move cursor to top-left
 */
function clearScreen(): void {
  process.stdout.write("\x1B[2J\x1B[H");
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
      // Watch mode - continuously update using alternate screen buffer
      let running = true;

      // Handle Ctrl+C gracefully - restore terminal before exiting
      const cleanup = () => {
        running = false;
        exitAlternateScreen();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      // Enter alternate screen buffer
      enterAlternateScreen();

      while (running) {
        try {
          clearScreen();
          const { daemonStatus, processes } = await fetchStatus();
          renderStatus(daemonStatus, processes, true);
        } catch (error) {
          clearScreen();
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
          } else {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.log(chalk.red(`✖ ${errorMsg}`));
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
