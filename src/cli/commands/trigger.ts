/**
 * Trigger Command
 *
 * Directly trigger a pipeline stage by name, bypassing the event system.
 * Useful for manually starting stages that aren't auto-triggered.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import { printError, printSuccess, printWarning } from "../utils/formatter.js";

/**
 * Directly trigger a pipeline stage
 *
 * @param stageName - Name of the stage to trigger
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function triggerCommand(stageName: string): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nTriggering stage: ${stageName}`));

    await client.request("stage.trigger", { stageName });

    printSuccess(`Stage "${stageName}" triggered successfully`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      printWarning("Clier daemon is not running");
      console.log();
      console.log("  Start it with: clier start");
      console.log();
      return 1;
    }

    if (error instanceof Error && error.message.includes("not found")) {
      printError(`Stage "${stageName}" not found in pipeline`);
      console.log();
      console.log("  Run 'clier status' to see available stages");
      console.log();
      return 1;
    }

    if (error instanceof Error && error.message.includes("already started")) {
      printWarning(`Stage "${stageName}" is already running`);
      console.log();
      console.log("  Use 'clier service restart' to restart it");
      console.log();
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
