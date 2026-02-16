/**
 * Workflow Commands
 *
 * CLI commands for managing workflows: run, cancel, status, and list.
 */

import chalk from "chalk";
import Table from "cli-table3";
import { getDaemonClient } from "../../daemon/client.js";
import type { WorkflowStatus } from "../../core/workflow-engine.js";
import {
  printSuccess,
  printError,
  printWarning,
} from "../utils/formatter.js";

/**
 * Run (trigger) a workflow by name
 */
export async function workflowRunCommand(name: string): Promise<number> {
  try {
    const client = await getDaemonClient();

    console.log(chalk.cyan(`\nTriggering workflow: ${name}`));

    await client.request<{ success: true }>("workflow.run", { name });

    printSuccess(`Workflow "${name}" completed successfully`);
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
