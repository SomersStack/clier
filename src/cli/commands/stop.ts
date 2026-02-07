/**
 * Stop Command
 *
 * Stops the daemon and all running processes.
 * Can also stop individual processes if a process name is provided.
 */

import * as fs from "fs";
import * as path from "path";
import ora from "ora";
import { getDaemonClient } from "../../daemon/client.js";
import { findProjectRootForDaemon } from "../../utils/project-root.js";
import { printError, printWarning } from "../utils/formatter.js";

export interface StopOptions {
  /** Optional process name to stop (if not provided, stops entire daemon) */
  process?: string;
}

/**
 * Stop the daemon or a specific process
 *
 * @param options - Stop options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function stopCommand(options: StopOptions = {}): Promise<number> {
  try {
    const client = await getDaemonClient();

    if (options.process) {
      // Stop specific process
      const spinner = ora(`Stopping process ${options.process}...`).start();

      try {
        await client.request("process.stop", { name: options.process });
        spinner.succeed(`Process ${options.process} stopped`);
        client.disconnect();
        return 0;
      } catch (error) {
        spinner.fail(`Failed to stop process ${options.process}`);
        printError(error instanceof Error ? error.message : String(error));
        client.disconnect();
        return 1;
      }
    } else {
      // Stop entire daemon
      const spinner = ora("Stopping daemon...").start();

      try {
        await client.request("daemon.shutdown");
        client.disconnect();

        // Wait for daemon to exit
        await waitForDaemonExit(5000);

        spinner.succeed("Daemon stopped");
        return 0;
      } catch (error) {
        spinner.fail("Failed to stop daemon");
        printError(error instanceof Error ? error.message : String(error));
        client.disconnect();
        return 1;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      printWarning("Clier daemon is not running");
      console.log();
      return 0; // Not an error if already stopped
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Wait for daemon to exit
 *
 * Waits for both socket connection to fail AND the process to actually exit.
 * This prevents a race condition where the IPC server stops but the daemon
 * is still running cleanup (e.g., stopping child processes).
 */
async function waitForDaemonExit(timeoutMs: number): Promise<void> {
  const start = Date.now();

  // Find the project root to locate PID file
  let projectRoot: string;
  try {
    projectRoot = findProjectRootForDaemon();
  } catch {
    // No project found, daemon is already gone
    return;
  }

  const pidPath = path.join(projectRoot, ".clier", "daemon.pid");

  while (Date.now() - start < timeoutMs) {
    // Check 1: Socket connection should fail (IPC server stopped)
    let socketAlive = false;
    try {
      const client = await getDaemonClient();
      client.disconnect();
      socketAlive = true;
    } catch {
      // Socket connection failed - server is down
    }

    // Check 2: Process should no longer be running
    let processAlive = false;
    if (fs.existsSync(pidPath)) {
      try {
        const pidStr = fs.readFileSync(pidPath, "utf-8");
        const pid = parseInt(pidStr.trim());
        // Signal 0 checks if process exists without sending a signal
        process.kill(pid, 0);
        processAlive = true;
      } catch {
        // Process doesn't exist or we can't signal it
      }
    }

    // Daemon is fully down when both socket and process are gone
    if (!socketAlive && !processAlive) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Timeout - daemon might still be running but we gave it enough time
}
