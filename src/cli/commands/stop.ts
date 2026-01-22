/**
 * Stop Command
 *
 * Stops the daemon and all running processes.
 * Can also stop individual processes if a process name is provided.
 */

import ora from "ora";
import { getDaemonClient } from "../../daemon/client.js";
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
export async function stopCommand(
  options: StopOptions = {}
): Promise<number> {
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
    if (
      error instanceof Error &&
      error.message.includes("not running")
    ) {
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
 */
async function waitForDaemonExit(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const client = await getDaemonClient();
      client.disconnect();
      // Still running, wait a bit more
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      // Daemon is down
      return;
    }
  }
  // Timeout - daemon might still be running but we gave it enough time
}
