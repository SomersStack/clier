/**
 * Restart Command
 *
 * Performs a full daemon restart (stop + start).
 * This creates a new daemon process with a new PID.
 * Use `clier reload` for faster config updates without full daemon restart.
 */

import ora from "ora";
import { stopCommand } from "./stop.js";
import { startCommand } from "./start.js";
import { printError, printSuccess } from "../utils/formatter.js";

/**
 * Restart the Clier daemon
 *
 * Performs a complete stop and start sequence, resulting in a new daemon process.
 * Automatically searches upward for clier-pipeline.json if not explicitly provided.
 *
 * @param configPath - Path to configuration file (optional, auto-detected if not provided)
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function restartCommand(configPath?: string): Promise<number> {
  const spinner = ora();

  try {
    console.log();
    spinner.info("Restarting Clier daemon (full restart with new PID)");
    console.log();

    // Step 1: Stop the daemon
    const stopResult = await stopCommand();
    if (stopResult !== 0) {
      // If stop failed for a reason other than "not running", return error
      // (stopCommand returns 0 if daemon was not running)
      return stopResult;
    }

    // Small delay to ensure daemon fully shut down
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Step 2: Start the daemon
    const startResult = await startCommand(configPath);
    if (startResult !== 0) {
      printError("Failed to start daemon after stopping");
      return startResult;
    }

    printSuccess("Daemon restarted successfully");
    console.log();

    return 0;
  } catch (error) {
    spinner.fail("Failed to restart daemon");
    printError(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }
}
