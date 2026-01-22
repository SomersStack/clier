/**
 * Clier CLI
 *
 * Main CLI entry point using Commander.js
 */

import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { reloadCommand } from "./commands/reload.js";
import { validateCommand } from "./commands/validate.js";
import { updateCommand } from "./commands/update.js";
import {
  serviceStartCommand,
  serviceStopCommand,
  serviceRestartCommand,
  serviceAddCommand,
  serviceRemoveCommand,
} from "./commands/service.js";

/**
 * Create and configure the CLI program
 *
 * @returns Configured Commander program
 */
export function createCLI(): Command {
  const program = new Command();

  program
    .name("clier")
    .description(
      "Process orchestration framework with event-driven pipeline management"
    )
    .version("0.2.0");

  // Start command
  program
    .command("start")
    .description("Start the pipeline (runs in foreground)")
    .argument(
      "[config]",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)"
    )
    .action(async (configPath?: string) => {
      const exitCode = await startCommand(configPath);
      process.exit(exitCode);
    });

  // Stop command
  program
    .command("stop")
    .description("Show instructions for stopping the pipeline")
    .action(async () => {
      const exitCode = await stopCommand();
      process.exit(exitCode);
    });

  // Status command
  program
    .command("status")
    .description("Show process log status")
    .action(async () => {
      const exitCode = await statusCommand();
      process.exit(exitCode);
    });

  // Logs command
  program
    .command("logs")
    .description("Show logs for a specific process")
    .argument("<name>", "Process name")
    .option("-n, --lines <number>", "Number of lines to show", "100")
    .option("--since <duration>", "Show logs since duration (e.g., 5m, 1h, 30s)")
    .action(
      async (name: string, options: { lines: string; since?: string }) => {
        const exitCode = await logsCommand(name, {
          lines: parseInt(options.lines, 10),
          since: options.since,
        });
        process.exit(exitCode);
      }
    );

  // Reload command
  program
    .command("reload")
    .description("Reload config (restart required with new architecture)")
    .argument(
      "[config]",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)"
    )
    .action(async (configPath?: string) => {
      const exitCode = await reloadCommand(configPath);
      process.exit(exitCode);
    });

  // Validate command
  program
    .command("validate")
    .description("Validate config file")
    .argument(
      "[config]",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)"
    )
    .action(async (configPath?: string) => {
      const exitCode = await validateCommand(configPath);
      process.exit(exitCode);
    });

  // Update command
  program
    .command("update")
    .description("Update @clier/core to the latest version")
    .option("-g, --global", "Update global installation (default: true)")
    .option("--no-global", "Update local installation")
    .option("-c, --check", "Check for updates without installing")
    .action(async (options: { global?: boolean; check?: boolean }) => {
      const exitCode = await updateCommand(options);
      process.exit(exitCode);
    });

  // Service commands (for controlling individual processes)
  const service = program
    .command("service")
    .description("Control individual services/processes");

  service
    .command("start")
    .description("Start a specific service")
    .argument("<name>", "Service name")
    .action(async (name: string) => {
      const exitCode = await serviceStartCommand(name);
      process.exit(exitCode);
    });

  service
    .command("stop")
    .description("Stop a specific service")
    .argument("<name>", "Service name")
    .action(async (name: string) => {
      const exitCode = await serviceStopCommand(name);
      process.exit(exitCode);
    });

  service
    .command("restart")
    .description("Restart a specific service")
    .argument("<name>", "Service name")
    .action(async (name: string) => {
      const exitCode = await serviceRestartCommand(name);
      process.exit(exitCode);
    });

  service
    .command("add")
    .description("Add a new service to the running pipeline")
    .argument("<name>", "Service name")
    .requiredOption("-c, --command <command>", "Command to execute")
    .option("--cwd <directory>", "Working directory")
    .option("--type <type>", "Process type (service or task)", "service")
    .option("-e, --env <KEY=VALUE...>", "Environment variables", [])
    .option("--no-restart", "Disable auto-restart")
    .action(
      async (
        name: string,
        options: {
          command: string;
          cwd?: string;
          type: "service" | "task";
          env: string[];
          restart: boolean;
        }
      ) => {
        const exitCode = await serviceAddCommand(name, options);
        process.exit(exitCode);
      }
    );

  service
    .command("remove")
    .description("Remove a service from the running pipeline")
    .argument("<name>", "Service name")
    .action(async (name: string) => {
      const exitCode = await serviceRemoveCommand(name);
      process.exit(exitCode);
    });

  return program;
}

/**
 * Run the CLI
 *
 * @param argv - Command line arguments
 */
export async function runCLI(argv: string[] = process.argv): Promise<void> {
  // Check for updates on startup (unless running the update command itself)
  const isUpdateCommand = argv.includes("update");
  if (!isUpdateCommand) {
    await checkForUpdatesOnStartup();
  }

  const program = createCLI();
  await program.parseAsync(argv);
}

/**
 * Check for updates on startup and show a prompt if available
 */
async function checkForUpdatesOnStartup(): Promise<void> {
  try {
    const { checkForUpdates, shouldShowUpdatePrompt } = await import(
      "./utils/version-checker.js"
    );
    const { printWarning, printInfo } = await import("./utils/formatter.js");

    // Only check once per day
    if (!shouldShowUpdatePrompt()) {
      return;
    }

    // Quick check for updates (with timeout)
    const updateCheckPromise = checkForUpdates();
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 2000),
    );

    const updateInfo = await Promise.race([updateCheckPromise, timeoutPromise]);

    // If timed out or no update available, continue
    if (!updateInfo || !updateInfo.hasUpdate) {
      return;
    }

    // Show update notification
    console.log();
    printWarning("A new version of @clier/core is available!");
    console.log(`  Current: ${updateInfo.currentVersion}`);
    console.log(`  Latest:  ${updateInfo.latestVersion}`);
    console.log();
    printInfo("Run 'clier update' to update to the latest version.");
    console.log();
  } catch {
    // Silently fail - don't interrupt the user's workflow
  }
}
