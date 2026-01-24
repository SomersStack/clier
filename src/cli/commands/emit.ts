/**
 * Emit Command
 *
 * Emit a custom event to trigger waiting pipeline stages.
 * This allows manual triggering of stages via the event system.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import {
  printError,
  printSuccess,
  printWarning,
  printInfo,
} from "../utils/formatter.js";

/**
 * Emit a custom event to trigger waiting pipeline stages
 *
 * @param eventName - Name of the event to emit
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function emitCommand(
  eventName: string,
  options: { data?: string }
): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nEmitting event: ${eventName}`));

    // Parse data if provided (JSON string)
    let data: string | Record<string, unknown> | undefined;
    if (options.data) {
      try {
        data = JSON.parse(options.data);
      } catch {
        // Use as plain string if not valid JSON
        data = options.data;
      }
    }

    const result = await client.request<{
      success: true;
      triggeredStages: string[];
    }>("event.emit", { eventName, data });

    if (result.triggeredStages.length > 0) {
      printSuccess(`Event "${eventName}" emitted`);
      console.log();
      printInfo(`Stages waiting for this event: ${result.triggeredStages.join(", ")}`);
    } else {
      printSuccess(`Event "${eventName}" emitted`);
      console.log();
      printWarning("No stages are waiting for this event");
      console.log(
        chalk.gray(
          "  (Either no stages have this event in trigger_on, or their other dependencies are not satisfied)"
        )
      );
    }
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

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
