/**
 * Update Command
 *
 * Updates the @clier/core package to the latest version.
 */

import { exec } from "child_process";
import { promisify } from "util";
import ora from "ora";
import {
  printSuccess,
  printError,
  printInfo,
  printWarning,
} from "../utils/formatter.js";
import { checkForUpdates } from "../utils/version-checker.js";

const execAsync = promisify(exec);

/**
 * Detect which package manager is being used
 *
 * @returns Package manager command (npm, yarn, pnpm, or bun)
 */
async function detectPackageManager(): Promise<string> {
  const managers = [
    { name: "bun", command: "bun --version" },
    { name: "pnpm", command: "pnpm --version" },
    { name: "yarn", command: "yarn --version" },
    { name: "npm", command: "npm --version" },
  ];

  for (const manager of managers) {
    try {
      await execAsync(manager.command);
      return manager.name;
    } catch {
      // Manager not available, try next
    }
  }

  // Default to npm
  return "npm";
}

/**
 * Get the update command for a package manager
 *
 * @param packageManager - Package manager name
 * @param global - Whether to update globally
 * @returns Update command
 */
function getUpdateCommand(packageManager: string, global: boolean): string {
  const packageName = "@clier/core";

  if (global) {
    switch (packageManager) {
      case "npm":
        return `npm install -g ${packageName}@latest`;
      case "yarn":
        return `yarn global add ${packageName}@latest`;
      case "pnpm":
        return `pnpm add -g ${packageName}@latest`;
      case "bun":
        return `bun add -g ${packageName}@latest`;
      default:
        return `npm install -g ${packageName}@latest`;
    }
  } else {
    switch (packageManager) {
      case "npm":
        return `npm install ${packageName}@latest`;
      case "yarn":
        return `yarn add ${packageName}@latest`;
      case "pnpm":
        return `pnpm add ${packageName}@latest`;
      case "bun":
        return `bun add ${packageName}@latest`;
      default:
        return `npm install ${packageName}@latest`;
    }
  }
}

/**
 * Update command
 *
 * @param options - Command options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function updateCommand(options: {
  global?: boolean;
  check?: boolean;
}): Promise<number> {
  try {
    // If check flag is provided, just check for updates
    if (options.check) {
      const spinner = ora("Checking for updates...").start();
      const updateInfo = await checkForUpdates();

      if (!updateInfo.hasUpdate) {
        spinner.succeed("You are already on the latest version!");
        printInfo(`Current version: ${updateInfo.currentVersion}`);
        return 0;
      }

      spinner.stop();
      printWarning("A new version is available!");
      console.log();
      console.log(`  Current version: ${updateInfo.currentVersion}`);
      console.log(`  Latest version:  ${updateInfo.latestVersion}`);
      console.log();
      printInfo("Run 'clier update' to update to the latest version.");
      return 0;
    }

    // Check for updates first
    const checkSpinner = ora("Checking for updates...").start();
    const updateInfo = await checkForUpdates();

    if (!updateInfo.hasUpdate) {
      checkSpinner.succeed("You are already on the latest version!");
      printInfo(`Current version: ${updateInfo.currentVersion}`);
      return 0;
    }

    checkSpinner.succeed("New version available!");
    console.log();
    console.log(`  Current version: ${updateInfo.currentVersion}`);
    console.log(`  Latest version:  ${updateInfo.latestVersion}`);
    console.log();

    // Detect package manager
    const packageManager = await detectPackageManager();
    printInfo(`Detected package manager: ${packageManager}`);

    // Determine if installed globally
    const isGlobal = options.global ?? true; // Default to global
    const updateCommand = getUpdateCommand(packageManager, isGlobal);

    console.log();
    printInfo(`Running: ${updateCommand}`);
    console.log();

    // Run the update
    const updateSpinner = ora("Updating @clier/core...").start();

    try {
      const { stdout, stderr } = await execAsync(updateCommand);

      if (stderr && !stderr.includes("npm WARN")) {
        updateSpinner.fail("Update failed");
        console.error(stderr);
        return 1;
      }

      updateSpinner.succeed("Successfully updated to the latest version!");
      console.log();
      printSuccess(`Updated to version ${updateInfo.latestVersion}`);
      console.log();

      // Show any relevant output (skip npm warnings)
      if (stdout) {
        const lines = stdout
          .split("\n")
          .filter((line) => !line.includes("npm WARN") && line.trim());
        if (lines.length > 0) {
          console.log("Output:");
          lines.forEach((line) => console.log(`  ${line}`));
          console.log();
        }
      }

      return 0;
    } catch (error) {
      updateSpinner.fail("Update failed");
      const err = error as Error & { stderr?: string; stdout?: string };
      printError(
        `Failed to update: ${err.stderr || err.stdout || err.message}`,
      );
      console.log();
      printInfo(`You can also update manually by running:`);
      console.log(`  ${updateCommand}`);
      return 1;
    }
  } catch (error) {
    printError(
      `Failed to update: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
