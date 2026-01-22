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

/**
 * Show status of daemon and all processes
 *
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function statusCommand(): Promise<number> {
  try {
    const client = await getDaemonClient();

    // Get daemon status
    const daemonStatus: DaemonStatus =
      await client.request("daemon.status");

    // Get process list
    const processes: ProcessStatus[] = await client.request("process.list");

    client.disconnect();

    // Display daemon status
    console.log();
    console.log(chalk.bold("Daemon Status"));
    console.log(chalk.gray("─────────────────"));
    console.log(`  PID:      ${daemonStatus.pid}`);
    console.log(`  Uptime:   ${formatUptime(daemonStatus.uptime)}`);
    console.log(`  Config:   ${daemonStatus.configPath}`);
    console.log();

    // Display process status
    console.log(chalk.bold("Processes"));
    console.log(chalk.gray("─────────────────"));

    if (processes.length === 0) {
      console.log(chalk.gray("  No processes running"));
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

      console.log(table.toString());
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
