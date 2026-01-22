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

  return program;
}

/**
 * Run the CLI
 *
 * @param argv - Command line arguments
 */
export async function runCLI(argv: string[] = process.argv): Promise<void> {
  const program = createCLI();
  await program.parseAsync(argv);
}
