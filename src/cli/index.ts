/**
 * Clier CLI
 *
 * Main CLI entry point using Commander.js
 */

import { Command } from "commander";
import { createRequire } from "module";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");
import { restartCommand } from "./commands/restart.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";
import { logsClearCommand } from "./commands/logs-clear.js";
import { reloadCommand } from "./commands/reload.js";
import { validateCommand } from "./commands/validate.js";
import { updateCommand } from "./commands/update.js";
import { docsCommand } from "./commands/docs.js";
import { initCommand } from "./commands/init.js";
import {
  serviceStartCommand,
  serviceStopCommand,
  serviceRestartCommand,
  serviceAddCommand,
  serviceRemoveCommand,
} from "./commands/service.js";
import { emitCommand } from "./commands/emit.js";
import { inputCommand } from "./commands/input.js";
import { eventsCommand, type EventsOptions } from "./commands/events.js";
import {
  templateListCommand,
  templateApplyCommand,
  templateShowCommand,
} from "./commands/template.js";
import {
  workflowRunCommand,
  workflowCancelCommand,
  workflowStatusCommand,
  workflowListCommand,
} from "./commands/workflow.js";

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
      "Process orchestration framework with event-driven pipeline management",
    )
    .version(packageJson.version)
    .enablePositionalOptions();

  // Start command
  program
    .command("start")
    .description("Start the pipeline (runs in foreground)")
    .argument(
      "[config]",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)",
    )
    .option(
      "--paused",
      "Start daemon without auto-starting any entry points",
    )
    .action(async (configPath?: string, options?: { paused?: boolean }) => {
      const exitCode = await startCommand(configPath, {
        paused: options?.paused,
      });
      process.exit(exitCode);
    });

  // Stop command
  program
    .command("stop")
    .description("Stop a service by name, or stop the entire pipeline")
    .argument("[name]", "Service name to stop (omit to stop entire pipeline)")
    .action(async (name?: string) => {
      const exitCode = await stopCommand(name ? { process: name } : {});
      process.exit(exitCode);
    });

  // Restart command
  program
    .command("restart")
    .description(
      "Restart a service by name, or restart daemon completely (new PID)",
    )
    .argument("[name]", "Service name to restart (omit to restart daemon)")
    .option(
      "--config <path>",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)",
    )
    .action(async (name?: string, options?: { config?: string }) => {
      if (name) {
        const exitCode = await serviceRestartCommand(name, false);
        process.exit(exitCode);
      } else {
        const exitCode = await restartCommand(options?.config);
        process.exit(exitCode);
      }
    });

  // Status command
  program
    .command("status")
    .description("Show process log status")
    .option(
      "-w, --watch",
      "Watch mode - continuously update the status display",
    )
    .option(
      "-n, --interval <seconds>",
      "Refresh interval in seconds (default: 2)",
      "2",
    )
    .option("--json", "Output as JSON (cannot be used with --watch)")
    .action(
      async (options: {
        watch?: boolean;
        interval: string;
        json?: boolean;
      }) => {
        const exitCode = await statusCommand({
          watch: options.watch,
          interval: parseFloat(options.interval),
          json: options.json,
        });
        process.exit(exitCode);
      },
    );

  // Watch command (alias for status -w)
  program
    .command("watch")
    .description("Watch process status (alias for status -w)")
    .option(
      "-n, --interval <seconds>",
      "Refresh interval in seconds (default: 2)",
      "2",
    )
    .action(async (options: { interval: string }) => {
      const exitCode = await statusCommand({
        watch: true,
        interval: parseFloat(options.interval),
      });
      process.exit(exitCode);
    });

  // Logs commands
  const logs = program
    .command("logs")
    .description("Show or manage logs for processes and daemon");

  // Default logs show command (direct on parent for backward compatibility)
  logs
    .argument("[name]", "Process name (not required with --daemon)")
    .option("-n, --lines <number>", "Number of lines to show", "100")
    .option(
      "--since <duration>",
      "Show logs since duration (e.g., 5m, 1h, 30s)",
    )
    .option("-d, --daemon", "Show daemon logs instead of process logs")
    .option(
      "-l, --level <level>",
      "Log level for daemon logs (combined or error)",
      "combined",
    )
    .action(
      async (
        name: string | undefined,
        options: {
          lines: string;
          since?: string;
          daemon?: boolean;
          level?: "combined" | "error";
        },
      ) => {
        // Validate that name is provided if not using --daemon
        if (!options.daemon && !name) {
          console.error(
            "Error: Process name is required unless using --daemon",
          );
          console.log();
          console.log("Usage:");
          console.log("  clier logs <name>         Show process logs");
          console.log("  clier logs --daemon       Show daemon logs");
          console.log("  clier logs clear <name>   Clear process logs");
          console.log();
          process.exit(1);
        }

        const exitCode = await logsCommand(name || "", {
          lines: parseInt(options.lines, 10),
          since: options.since,
          daemon: options.daemon,
          level: options.level,
        });
        process.exit(exitCode);
      },
    );

  // Logs clear subcommand
  logs
    .command("clear")
    .description("Clear logs for a process, all processes, or daemon")
    .argument("[name]", "Process name (use --all for all logs)")
    .option("-a, --all", "Clear all logs (processes + daemon)")
    .option("-d, --daemon", "Clear daemon logs only")
    .option(
      "-l, --level <level>",
      "Daemon log level to clear (combined, error, or all)",
      "all",
    )
    .action(
      async (
        name: string | undefined,
        options: {
          all?: boolean;
          daemon?: boolean;
          level?: "combined" | "error" | "all";
        },
      ) => {
        const exitCode = await logsClearCommand(name || "", {
          all: options.all,
          daemon: options.daemon,
          level: options.level,
        });
        process.exit(exitCode);
      },
    );

  // Reload command
  program
    .command("reload")
    .description(
      "Reload config (same PID, restarts all processes), or restart a service by name",
    )
    .argument("[name]", "Service name to restart (omit to reload config)")
    .option(
      "--config <path>",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)",
    )
    .option(
      "--restart-manual",
      "Re-start any services that were manually started (via 'clier service start')",
    )
    .action(
      async (
        name?: string,
        options?: { config?: string; restartManual?: boolean },
      ) => {
        if (name) {
          const exitCode = await serviceRestartCommand(name, false);
          process.exit(exitCode);
        } else {
          const exitCode = await reloadCommand(options?.config, {
            restartManualServices: options?.restartManual,
          });
          process.exit(exitCode);
        }
      },
    );

  // Refresh command (alias for reload --restart-manual)
  program
    .command("refresh")
    .description(
      "Reload config and restart manual services (alias for reload --restart-manual)",
    )
    .option(
      "--config <path>",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)",
    )
    .action(async (options?: { config?: string }) => {
      const exitCode = await reloadCommand(options?.config, {
        restartManualServices: true,
      });
      process.exit(exitCode);
    });

  // Validate command
  program
    .command("validate")
    .description("Validate config file")
    .argument(
      "[config]",
      "Path to clier-pipeline.json (default: ./clier-pipeline.json)",
    )
    .action(async (configPath?: string) => {
      const exitCode = await validateCommand(configPath);
      process.exit(exitCode);
    });

  // Update command
  program
    .command("update")
    .description("Update clier-ai to the latest version")
    .option("-g, --global", "Update global installation (default: true)")
    .option("--no-global", "Update local installation")
    .option("-c, --check", "Check for updates without installing")
    .action(async (options: { global?: boolean; check?: boolean }) => {
      const exitCode = await updateCommand(options);
      process.exit(exitCode);
    });

  // Docs command
  program
    .command("docs")
    .description("Show documentation")
    .argument(
      "[subject]",
      "Documentation subject (commands, pipeline, workflows, all)",
      "all",
    )
    .option("-l, --list", "List available documentation subjects")
    .action(async (subject: string, options: { list?: boolean }) => {
      const exitCode = await docsCommand({ subject, list: options.list });
      process.exit(exitCode);
    });

  // Init command
  program
    .command("init")
    .description("Initialize agent documentation in current project")
    .option(
      "-a, --agents",
      "Create AGENTS.md in project root instead of .claude/CLAUDE.md",
    )
    .option("-f, --force", "Overwrite existing file if present")
    .option("--append", "Append template to existing file")
    .action(
      async (options: {
        agents?: boolean;
        force?: boolean;
        append?: boolean;
      }) => {
        const exitCode = await initCommand(options);
        process.exit(exitCode);
      },
    );

  // Template commands (for generating pipeline stages from templates)
  const template = program
    .command("template")
    .description("Generate pipeline stages from templates");

  template
    .command("list")
    .description("List available stage templates")
    .option(
      "-c, --category <category>",
      "Filter by category (service, task, utility)",
    )
    .action(async (options: { category?: "service" | "task" | "utility" }) => {
      const exitCode = await templateListCommand(options);
      process.exit(exitCode);
    });

  template
    .command("show")
    .description("Show details for a specific template")
    .argument("<template>", "Template ID")
    .action(async (templateId: string) => {
      const exitCode = await templateShowCommand(templateId);
      process.exit(exitCode);
    });

  template
    .command("apply")
    .description("Apply a template to generate a pipeline stage")
    .argument("<template>", "Template ID")
    .option("-n, --name <name>", "Stage name (overrides template default)")
    .option("-v, --var <KEY=VALUE...>", "Template variables", [])
    .option("--add", "Add directly to clier-pipeline.json")
    .option("-o, --output <file>", "Output to specific file")
    .option("-f, --force", "Overwrite existing files without prompting")
    .action(
      async (
        templateId: string,
        options: {
          name?: string;
          var: string[];
          add?: boolean;
          output?: string;
          force?: boolean;
        },
      ) => {
        const exitCode = await templateApplyCommand(templateId, options);
        process.exit(exitCode);
      },
    );

  // Run command (alias for service start)
  program
    .command("run")
    .description("Start a specific service (alias for service start)")
    .argument("<name>", "Service name")
    .argument("[args...]", "Arguments to pass to process stdin (after --)")
    .passThroughOptions()
    .action(async (name: string, args: string[]) => {
      const exitCode = await serviceStartCommand(name, args);
      process.exit(exitCode);
    });

  // Kill command (alias for service stop --force)
  program
    .command("kill")
    .description("Force stop a service (alias for service stop --force)")
    .argument("<name>", "Service name")
    .action(async (name: string) => {
      const exitCode = await serviceStopCommand(name, true);
      process.exit(exitCode);
    });

  // Service commands (for controlling individual processes)
  const service = program
    .command("service")
    .description("Control individual services/processes")
    .enablePositionalOptions();

  service
    .command("start")
    .description("Start a specific service")
    .argument("<name>", "Service name")
    .argument("[args...]", "Arguments to pass to process stdin (after --)")
    .passThroughOptions()
    .action(async (name: string, args: string[]) => {
      const exitCode = await serviceStartCommand(name, args);
      process.exit(exitCode);
    });

  service
    .command("stop")
    .description("Stop a specific service")
    .argument("<name>", "Service name")
    .option("-f, --force", "Force kill with SIGKILL (immediate termination)")
    .action(async (name: string, options: { force?: boolean }) => {
      const exitCode = await serviceStopCommand(name, options.force ?? false);
      process.exit(exitCode);
    });

  service
    .command("restart")
    .description("Restart a specific service")
    .argument("<name>", "Service name")
    .option("-f, --force", "Force kill with SIGKILL (immediate termination)")
    .action(async (name: string, options: { force?: boolean }) => {
      const exitCode = await serviceRestartCommand(
        name,
        options.force ?? false,
      );
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
    .option(
      "--restart <policy>",
      "Restart policy: always, on-failure, never",
      "on-failure",
    )
    .action(
      async (
        name: string,
        options: {
          command: string;
          cwd?: string;
          type: "service" | "task";
          env: string[];
          restart: "always" | "on-failure" | "never";
        },
      ) => {
        const exitCode = await serviceAddCommand(name, options);
        process.exit(exitCode);
      },
    );

  service
    .command("remove")
    .description("Remove a service from the running pipeline")
    .argument("<name>", "Service name")
    .action(async (name: string) => {
      const exitCode = await serviceRemoveCommand(name);
      process.exit(exitCode);
    });

  // Input command - send input to a running process
  program
    .command("input")
    .description("Send input to a running process's stdin")
    .argument("<process>", "Process name to send input to")
    .argument("<data>", "Data to send to the process")
    .option("--no-newline", "Do not append newline to the input")
    .action(
      async (
        processName: string,
        data: string,
        options: { newline: boolean },
      ) => {
        const exitCode = await inputCommand(processName, data, {
          newline: options.newline,
        });
        process.exit(exitCode);
      },
    );

  // Send command (alias for input)
  program
    .command("send")
    .description("Send input to a running process (alias for input)")
    .argument("<process>", "Process name to send input to")
    .argument("<data>", "Data to send to the process")
    .option("--no-newline", "Do not append newline to the input")
    .action(
      async (
        processName: string,
        data: string,
        options: { newline: boolean },
      ) => {
        const exitCode = await inputCommand(processName, data, {
          newline: options.newline,
        });
        process.exit(exitCode);
      },
    );

  // Emit command - emit custom events to trigger waiting stages
  program
    .command("emit")
    .description("Emit a custom event to trigger waiting pipeline stages")
    .argument("<event>", "Event name to emit (e.g., 'build:complete')")
    .option("-d, --data <json>", "Optional JSON data to include with the event")
    .action(async (eventName: string, options: { data?: string }) => {
      const exitCode = await emitCommand(eventName, options);
      process.exit(exitCode);
    });

  // Events command - view event history
  program
    .command("events")
    .description("Show event history from the running pipeline")
    .option("-p, --process <name>", "Filter by process/service name")
    .option(
      "-t, --type <type>",
      "Filter by event type (success, error, crashed, custom, stdout, stderr)",
    )
    .option("-e, --event <name>", "Filter by event name (partial match)")
    .option("-n, --lines <number>", "Number of events to show", "100")
    .option(
      "--since <duration>",
      "Show events since duration (e.g., 5m, 1h, 30s)",
    )
    .action(
      async (options: {
        process?: string;
        type?: string;
        event?: string;
        lines: string;
        since?: string;
      }) => {
        const exitCode = await eventsCommand({
          process: options.process,
          type: options.type as EventsOptions["type"],
          name: options.event,
          lines: parseInt(options.lines, 10),
          since: options.since,
        });
        process.exit(exitCode);
      },
    );

  // Workflow commands
  const workflow = program
    .command("workflow")
    .description("Manage workflows");

  workflow
    .command("run")
    .description("Trigger a workflow")
    .argument("<name>", "Workflow name")
    .option("--json", "Output progress as NDJSON (machine-readable)")
    .action(async (name: string, options: { json?: boolean }) => {
      const exitCode = await workflowRunCommand(name, { json: options.json });
      process.exit(exitCode);
    });

  workflow
    .command("cancel")
    .description("Cancel a running workflow")
    .argument("<name>", "Workflow name")
    .action(async (name: string) => {
      const exitCode = await workflowCancelCommand(name);
      process.exit(exitCode);
    });

  workflow
    .command("status")
    .description("Show workflow status")
    .argument("[name]", "Workflow name (omit to list all)")
    .action(async (name?: string) => {
      const exitCode = await workflowStatusCommand(name);
      process.exit(exitCode);
    });

  workflow
    .command("list")
    .description("List all defined workflows")
    .action(async () => {
      const exitCode = await workflowListCommand();
      process.exit(exitCode);
    });

  // Flow command (alias for workflow run)
  program
    .command("flow")
    .description("Trigger a workflow (alias for workflow run)")
    .argument("<name>", "Workflow name")
    .option("--json", "Output progress as NDJSON (machine-readable)")
    .action(async (name: string, options: { json?: boolean }) => {
      const exitCode = await workflowRunCommand(name, { json: options.json });
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
    const { checkForUpdates, shouldShowUpdatePrompt } =
      await import("./utils/version-checker.js");
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
    printWarning("A new version of clier-ai is available!");
    console.log(`  Current: ${updateInfo.currentVersion}`);
    console.log(`  Latest:  ${updateInfo.latestVersion}`);
    console.log();
    printInfo("Run 'clier update' to update to the latest version.");
    console.log();
  } catch {
    // Silently fail - don't interrupt the user's workflow
  }
}
