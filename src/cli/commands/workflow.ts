/**
 * Workflow Commands
 *
 * CLI commands for managing workflows: run, cancel, status, and list.
 */

import chalk from "chalk";
import Table from "cli-table3";
import { getDaemonClient } from "../../daemon/client.js";
import type { WorkflowStatus, WorkflowRunStatus, WorkflowStepStatus } from "../../core/workflow-engine.js";
import {
  printSuccess,
  printError,
  printWarning,
} from "../utils/formatter.js";

/** Spinner frames for running steps */
const SPINNER = ["◐", "◓", "◑", "◒"];

/** Poll interval in ms */
const POLL_INTERVAL_MS = 500;

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Get the step target label (process or event name)
 */
function stepTarget(step: WorkflowStepStatus): string {
  return step.process || step.event || "-";
}

/**
 * Get the step duration if completed
 */
function stepDuration(step: WorkflowStepStatus): string {
  if (step.startedAt && step.completedAt) {
    return formatDuration(step.completedAt - step.startedAt);
  }
  return "";
}

/**
 * Render the human-friendly progress display
 */
function renderProgress(
  name: string,
  run: WorkflowRunStatus,
  spinnerIdx: number,
): string {
  const totalSteps = run.steps.length;
  const lines: string[] = [];

  lines.push(chalk.bold(`Workflow: ${name} (${totalSteps} steps)`));
  lines.push("");

  for (const step of run.steps) {
    const num = `Step ${step.index + 1}/${totalSteps}`;
    const target = `${step.action} ${stepTarget(step)}`;
    const duration = stepDuration(step);

    let icon: string;
    let statusText: string;

    switch (step.status) {
      case "completed":
        icon = chalk.green("✓");
        statusText = chalk.green("completed") + (duration ? chalk.gray(`  (${duration})`) : "");
        break;
      case "running":
        icon = chalk.cyan(SPINNER[spinnerIdx % SPINNER.length]);
        statusText = chalk.cyan("running...");
        break;
      case "failed":
        icon = chalk.red("✗");
        statusText = chalk.red("failed") + (step.error ? chalk.red(` — ${step.error}`) : "");
        break;
      case "skipped":
        icon = chalk.gray("○");
        statusText = chalk.gray("skipped");
        break;
      case "pending":
      default:
        icon = chalk.gray("○");
        statusText = chalk.gray("pending");
        break;
    }

    lines.push(`  ${icon} ${chalk.white(num)}  ${target.padEnd(20)} ${statusText}`);
  }

  return lines.join("\n");
}

/**
 * Run (trigger) a workflow by name, with live progress display
 */
export async function workflowRunCommand(
  name: string,
  options?: { json?: boolean },
): Promise<number> {
  const json = options?.json ?? false;

  try {
    const client = await getDaemonClient();

    // Start workflow (non-blocking)
    await client.request<{ success: true }>("workflow.start", { name });

    // Small delay to let the workflow initialize before first poll
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (json) {
      return await pollJson(client, name);
    } else {
      return await pollHuman(client, name);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      if (json) {
        console.log(JSON.stringify({ type: "error", error: "Clier daemon is not running" }));
      } else {
        printWarning("Clier daemon is not running");
        console.log("  Start it with: clier start");
      }
      return 1;
    }

    const msg = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(JSON.stringify({ type: "error", error: msg }));
    } else {
      printError(msg);
    }
    return 1;
  }
}

/**
 * Poll and display human-friendly progress
 */
async function pollHuman(
  client: { request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>; disconnect: () => void },
  name: string,
): Promise<number> {
  let spinnerIdx = 0;
  let linesWritten = 0;

  const poll = async (): Promise<WorkflowStatus> => {
    return client.request<WorkflowStatus>("workflow.status", { name });
  };

  const clearAndRender = (output: string) => {
    // Move cursor up to overwrite previous output
    if (linesWritten > 0) {
      process.stdout.write(`\x1b[${linesWritten}A\x1b[0J`);
    }
    process.stdout.write(output + "\n");
    linesWritten = output.split("\n").length;
  };

  // Initial render
  console.log();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await poll();
    const run = status.active;

    if (!run) {
      // Workflow hasn't started yet or already cleaned up
      clearAndRender(chalk.gray("  Waiting for workflow to start..."));
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      spinnerIdx++;
      continue;
    }

    clearAndRender(renderProgress(name, run, spinnerIdx));

    // Check terminal states
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      const totalDuration = run.completedAt
        ? formatDuration(run.completedAt - run.startedAt)
        : "";

      console.log();
      if (run.status === "completed") {
        printSuccess(
          `Workflow "${name}" completed successfully` +
            (totalDuration ? ` (${totalDuration})` : ""),
        );
      } else if (run.status === "failed") {
        printError(
          `Workflow "${name}" failed` +
            (run.error ? `: ${run.error}` : "") +
            (totalDuration ? ` (${totalDuration})` : ""),
        );
      } else {
        printWarning(`Workflow "${name}" was cancelled`);
      }
      console.log();

      client.disconnect();
      return run.status === "completed" ? 0 : 1;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    spinnerIdx++;
  }
}

/**
 * Poll and emit NDJSON progress
 */
async function pollJson(
  client: { request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>; disconnect: () => void },
  name: string,
): Promise<number> {
  const emitted = (line: Record<string, unknown>) => {
    console.log(JSON.stringify(line));
  };

  let prevStepStates: string[] = [];
  let startEmitted = false;

  const poll = async (): Promise<WorkflowStatus> => {
    return client.request<WorkflowStatus>("workflow.status", { name });
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await poll();
    const run = status.active;

    if (!run) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    // Emit started event once
    if (!startEmitted) {
      emitted({
        type: "started",
        workflow: name,
        steps: run.steps.length,
        timestamp: run.startedAt,
      });
      prevStepStates = run.steps.map(() => "pending");
      startEmitted = true;
    }

    // Diff step states and emit changes
    for (let i = 0; i < run.steps.length; i++) {
      const step = run.steps[i]!;
      const prevState = prevStepStates[i];

      if (step.status !== prevState) {
        const line: Record<string, unknown> = {
          type: "step",
          index: step.index,
          action: step.action,
          target: stepTarget(step),
          status: step.status,
        };
        if (step.startedAt && step.completedAt) {
          line.duration_ms = step.completedAt - step.startedAt;
        }
        if (step.error) {
          line.error = step.error;
        }
        emitted(line);
        prevStepStates[i] = step.status;
      }
    }

    // Check terminal states
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      const line: Record<string, unknown> = {
        type: run.status,
        workflow: name,
      };
      if (run.completedAt) {
        line.duration_ms = run.completedAt - run.startedAt;
      }
      if (run.error) {
        line.error = run.error;
      }
      emitted(line);

      client.disconnect();
      return run.status === "completed" ? 0 : 1;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Cancel a running workflow
 */
export async function workflowCancelCommand(name: string): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nCancelling workflow: ${name}`));

    await client.request<{ success: true }>("workflow.cancel", { name });

    printSuccess(`Workflow "${name}" cancelled`);
    console.log();

    client.disconnect();
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      printWarning("Clier daemon is not running");
      console.log("  Start it with: clier start");
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Show status of a specific workflow
 */
export async function workflowStatusCommand(name?: string): Promise<number> {
  try {
    const client = await getDaemonClient();

    if (name) {
      const status = await client.request<WorkflowStatus>("workflow.status", {
        name,
      });
      console.log();
      printWorkflowDetail(status);
    } else {
      const workflows = await client.request<WorkflowStatus[]>("workflow.list");
      console.log();
      if (workflows.length === 0) {
        console.log(chalk.gray("  No workflows defined"));
      } else {
        printWorkflowTable(workflows);
      }
    }

    console.log();
    client.disconnect();
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes("not running")) {
      printWarning("Clier daemon is not running");
      console.log("  Start it with: clier start");
      return 1;
    }

    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * List all defined workflows
 */
export async function workflowListCommand(): Promise<number> {
  return workflowStatusCommand();
}

/**
 * Print a table of workflows
 */
function printWorkflowTable(workflows: WorkflowStatus[]): void {
  const table = new Table({
    head: [
      chalk.white("Name"),
      chalk.white("Steps"),
      chalk.white("Trigger"),
      chalk.white("Status"),
      chalk.white("Failure"),
    ],
    style: { head: [], border: [] },
  });

  for (const wf of workflows) {
    const trigger = wf.manual
      ? chalk.yellow("manual")
      : wf.trigger_on.length > 0
        ? wf.trigger_on.join(", ")
        : chalk.gray("none");

    const status = wf.active
      ? formatWorkflowRunStatus(wf.active.status)
      : chalk.gray("idle");

    table.push([wf.name, wf.stepCount.toString(), trigger, status, wf.on_failure]);
  }

  console.log(chalk.bold("Workflows"));
  console.log(chalk.gray("─────────────────"));
  console.log(table.toString());
}

/**
 * Print detailed status for a single workflow
 */
function printWorkflowDetail(wf: WorkflowStatus): void {
  console.log(chalk.bold(`Workflow: ${wf.name}`));
  console.log(chalk.gray("─────────────────"));
  console.log(`  Steps:      ${wf.stepCount}`);
  console.log(`  Manual:     ${wf.manual ? "yes" : "no"}`);
  console.log(
    `  Triggers:   ${wf.trigger_on.length > 0 ? wf.trigger_on.join(", ") : chalk.gray("none")}`,
  );
  console.log(`  On failure: ${wf.on_failure}`);
  console.log(`  Timeout:    ${wf.timeout_ms}ms`);

  if (wf.active) {
    console.log();
    console.log(chalk.bold("  Active Run"));
    console.log(`    Status:  ${formatWorkflowRunStatus(wf.active.status)}`);
    console.log(
      `    Started: ${new Date(wf.active.startedAt).toLocaleTimeString()}`,
    );
    if (wf.active.triggeredBy) {
      console.log(`    Trigger: ${wf.active.triggeredBy}`);
    }
    if (wf.active.error) {
      console.log(`    Error:   ${chalk.red(wf.active.error)}`);
    }

    console.log();
    const stepTable = new Table({
      head: [
        chalk.white("#"),
        chalk.white("Action"),
        chalk.white("Target"),
        chalk.white("Status"),
      ],
      style: { head: [], border: [] },
    });

    for (const step of wf.active.steps) {
      stepTable.push([
        step.index.toString(),
        step.action,
        step.process || step.event || "-",
        formatStepStatus(step.status),
      ]);
    }

    console.log(stepTable.toString());
  }
}

function formatWorkflowRunStatus(status: string): string {
  switch (status) {
    case "running":
      return chalk.cyan("running");
    case "completed":
      return chalk.green("completed");
    case "failed":
      return chalk.red("failed");
    case "cancelled":
      return chalk.yellow("cancelled");
    default:
      return chalk.gray(status);
  }
}

function formatStepStatus(status: string): string {
  switch (status) {
    case "running":
      return chalk.cyan("running");
    case "completed":
      return chalk.green("completed");
    case "failed":
      return chalk.red("failed");
    case "skipped":
      return chalk.gray("skipped");
    case "pending":
      return chalk.gray("pending");
    default:
      return chalk.gray(status);
  }
}
