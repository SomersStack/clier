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
  json?: boolean;
}

/**
 * JSON output structure for daemon status
 */
interface JsonDaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: string;
  config?: string;
}

/**
 * JSON output structure for a process
 */
interface JsonProcessStatus {
  name: string;
  type: "service" | "task";
  status: string;
  pid: number | null;
  uptime: string;
  restarts: number;
}

/**
 * JSON output structure for a stage
 */
interface JsonStage {
  name: string;
  processes: JsonProcessStatus[];
}

/**
 * Complete JSON output structure
 */
interface JsonOutput {
  daemon: JsonDaemonStatus;
  stages: JsonStage[];
  processes: JsonProcessStatus[];
}

/**
 * Convert ProcessStatus to JSON format
 */
function toJsonProcess(proc: ProcessStatus): JsonProcessStatus {
  return {
    name: proc.name,
    type: proc.type,
    status: proc.status,
    pid: proc.pid ?? null,
    uptime: formatUptime(proc.uptime),
    restarts: proc.restarts,
  };
}

/**
 * Group processes by stage
 */
function groupByStage(
  processes: ProcessStatus[],
  stageMap: Record<string, string>,
): { stageGroups: Map<string, ProcessStatus[]>; ungrouped: ProcessStatus[] } {
  const stageGroups = new Map<string, ProcessStatus[]>();
  const ungrouped: ProcessStatus[] = [];

  for (const proc of processes) {
    const stageName = stageMap[proc.name];
    if (stageName) {
      if (!stageGroups.has(stageName)) {
        stageGroups.set(stageName, []);
      }
      stageGroups.get(stageName)!.push(proc);
    } else {
      ungrouped.push(proc);
    }
  }

  return { stageGroups, ungrouped };
}

/**
 * Create a process table
 */
function createProcessTable(processes: ProcessStatus[]): Table.Table {
  const table = new Table({
    head: [
      chalk.white("Name"),
      chalk.white("Type"),
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
      proc.type,
      formatStatus(proc.status),
      proc.pid?.toString() || "-",
      formatUptime(proc.uptime),
      proc.restarts.toString(),
    ]);
  }

  return table;
}

/**
 * Build status output and return as string with line count
 */
function buildStatusOutput(
  daemonStatus: DaemonStatus,
  processes: ProcessStatus[],
  stageMap: Record<string, string>,
  isWatch: boolean,
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

  // Group processes by stage
  const { stageGroups, ungrouped } = groupByStage(processes, stageMap);

  // Display each stage
  for (const [stageName, stageProcesses] of stageGroups) {
    lines.push(chalk.bold(`Stage: ${stageName}`));
    lines.push(chalk.gray("─────────────────"));

    if (stageProcesses.length === 0) {
      lines.push(chalk.gray("  No processes"));
    } else {
      const tableOutput = createProcessTable(stageProcesses).toString();
      lines.push(...tableOutput.split("\n"));
    }

    lines.push("");
  }

  // Display ungrouped processes (or all processes if no stages)
  if (ungrouped.length > 0 || stageGroups.size === 0) {
    lines.push(chalk.bold("Processes"));
    lines.push(chalk.gray("─────────────────"));

    if (ungrouped.length === 0 && stageGroups.size === 0) {
      lines.push(chalk.gray("  No processes running"));
    } else if (ungrouped.length > 0) {
      const tableOutput = createProcessTable(ungrouped).toString();
      lines.push(...tableOutput.split("\n"));
    }

    lines.push("");
  }

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
  stageMap: Record<string, string>,
  isWatch: boolean,
): number {
  const { output, lineCount } = buildStatusOutput(
    daemonStatus,
    processes,
    stageMap,
    isWatch,
  );
  console.log(output);
  return lineCount;
}

/**
 * Fetch status from daemon
 */
async function fetchStatus(): Promise<{
  daemonStatus: DaemonStatus;
  processes: ProcessStatus[];
  stageMap: Record<string, string>;
}> {
  const client = await getDaemonClient();
  const daemonStatus: DaemonStatus = await client.request("daemon.status");
  const processes: ProcessStatus[] = await client.request("process.list");
  const stageMap: Record<string, string> = await client.request("stages.map");
  client.disconnect();
  return { daemonStatus, processes, stageMap };
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
  options: StatusOptions = {},
): Promise<number> {
  const { watch = false, interval = 2, json = false } = options;

  // --json and --watch are mutually exclusive
  if (json && watch) {
    printError("Cannot use --json with --watch");
    return 1;
  }

  try {
    if (json) {
      // JSON output mode
      const { daemonStatus, processes, stageMap } = await fetchStatus();
      const { stageGroups, ungrouped } = groupByStage(processes, stageMap);

      const output: JsonOutput = {
        daemon: {
          running: true,
          pid: daemonStatus.pid,
          uptime: formatUptime(daemonStatus.uptime),
          config: daemonStatus.configPath,
        },
        stages: Array.from(stageGroups.entries()).map(([name, procs]) => ({
          name,
          processes: procs.map(toJsonProcess),
        })),
        processes: ungrouped.map(toJsonProcess),
      };

      console.log(JSON.stringify(output, null, 2));
      return 0;
    }

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
          const { daemonStatus, processes, stageMap } = await fetchStatus();
          renderStatus(daemonStatus, processes, stageMap, true);
        } catch (error) {
          clearScreen();
          if (error instanceof Error && error.message.includes("not running")) {
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
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            console.log(chalk.red(`✖ ${errorMsg}`));
          }
        }

        // Wait for the interval
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      }

      return 0;
    } else {
      // Single status check
      const { daemonStatus, processes, stageMap } = await fetchStatus();
      renderStatus(daemonStatus, processes, stageMap, false);
      return 0;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      if (json) {
        // JSON output when daemon not running
        const output: JsonOutput = {
          daemon: { running: false },
          stages: [],
          processes: [],
        };
        console.log(JSON.stringify(output, null, 2));
        return 0;
      }

      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    if (json) {
      console.error(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } else {
      printError(error instanceof Error ? error.message : String(error));
    }
    return 1;
  }
}
