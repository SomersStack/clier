/**
 * Input Command
 *
 * Sends input to a running process's stdin.
 * Requires the process to have input enabled in its configuration.
 */

import chalk from "chalk";
import { getDaemonClient } from "../../daemon/client.js";
import { printError, printSuccess, printWarning } from "../utils/formatter.js";

/**
 * Send input to a running process
 *
 * @param processName - Name of the process to send input to
 * @param input - The input string to send
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function inputCommand(
  processName: string,
  input: string,
  options: { newline?: boolean } = {},
): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nSending input to: ${processName}`));

    const result = await client.request("process.input", {
      name: processName,
      data: input,
      appendNewline: options.newline ?? true,
    });

    printSuccess(`Sent ${result.bytesWritten} bytes to "${processName}"`);
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
