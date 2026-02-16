/**
 * Workflow Engine
 *
 * Manages workflow registration, trigger evaluation, and sequential step execution.
 * Workflows are triggered by events or manually via CLI, and execute steps
 * that can start/stop/restart processes, await events, and emit custom events.
 */

import type { WorkflowItem, WorkflowStep, WorkflowCondition } from "../config/types.js";
import type { ClierEvent, EventHandlerFn } from "../types/events.js";
import type { ProcessManager } from "./process-manager.js";
import type { EventHandler } from "./event-handler.js";
import type { Orchestrator } from "./orchestrator.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("WorkflowEngine");

/** Default workflow timeout: 10 minutes */
const DEFAULT_WORKFLOW_TIMEOUT_MS = 600_000;

/** Status of a single workflow step */
export type WorkflowStepStatus = {
  index: number;
  action: string;
  process?: string;
  event?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  error?: string;
  startedAt?: number;
  completedAt?: number;
};

/** Status of a workflow run */
export type WorkflowRunStatus = {
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  triggeredBy?: string;
  startedAt: number;
  completedAt?: number;
  steps: WorkflowStepStatus[];
  currentStep: number;
  error?: string;
};

/** Public workflow status (includes definition info) */
export type WorkflowStatus = {
  name: string;
  manual: boolean;
  trigger_on: string[];
  on_failure: string;
  timeout_ms: number;
  stepCount: number;
  active?: WorkflowRunStatus;
};

/** Internal state for a running workflow */
interface WorkflowRun {
  workflow: WorkflowItem;
  status: WorkflowRunStatus;
  abortController: AbortController;
  promise: Promise<void>;
}

export class WorkflowEngine {
  private workflows = new Map<string, WorkflowItem>();
  private activeRuns = new Map<string, WorkflowRun>();
  private receivedEvents = new Map<string, Set<string>>();

  constructor(
    private processManager: ProcessManager,
    private eventHandler: EventHandler,
    private orchestrator: Orchestrator,
  ) {}

  /**
   * Load workflow definitions from config
   */
  loadWorkflows(workflows: WorkflowItem[]): void {
    this.workflows.clear();
    this.receivedEvents.clear();

    for (const wf of workflows) {
      this.workflows.set(wf.name, wf);

      // Initialize trigger tracking for event-triggered workflows
      if (wf.trigger_on && wf.trigger_on.length > 0 && !wf.manual) {
        this.receivedEvents.set(wf.name, new Set());
      }

      logger.info("Registered workflow", {
        name: wf.name,
        steps: wf.steps.length,
        manual: wf.manual ?? false,
        trigger_on: wf.trigger_on,
      });
    }
  }

  /**
   * Handle an event from the event system — check if it triggers any workflows
   */
  handleEvent(event: ClierEvent): void {
    for (const [name, wf] of this.workflows) {
      if (wf.manual || !wf.trigger_on || wf.trigger_on.length === 0) continue;

      const received = this.receivedEvents.get(name);
      if (!received) continue;

      if (wf.trigger_on.includes(event.name)) {
        received.add(event.name);

        // Check if all triggers are satisfied
        if (wf.trigger_on.every((t) => received.has(t))) {
          // Reset received events for re-triggering
          received.clear();

          // Don't trigger if already running
          if (this.activeRuns.has(name)) {
            logger.warn("Workflow already running, skipping trigger", { name });
            continue;
          }

          logger.info("All triggers satisfied for workflow", {
            name,
            triggeredBy: event.name,
          });
          this.triggerWorkflow(name, event.name).catch((err) => {
            logger.error("Failed to trigger workflow", {
              name,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    }
  }

  /**
   * Trigger a workflow by name
   */
  async triggerWorkflow(name: string, triggeredBy?: string): Promise<void> {
    const wf = this.workflows.get(name);
    if (!wf) {
      throw new Error(`Workflow "${name}" not found`);
    }

    if (this.activeRuns.has(name)) {
      throw new Error(`Workflow "${name}" is already running`);
    }

    const abortController = new AbortController();
    const status: WorkflowRunStatus = {
      name,
      status: "running",
      triggeredBy,
      startedAt: Date.now(),
      currentStep: 0,
      steps: wf.steps.map((step, i) => ({
        index: i,
        action: step.action,
        process: step.process,
        event: step.event,
        status: "pending",
      })),
    };

    const promise = this.executeWorkflow(wf, status, abortController);

    const run: WorkflowRun = { workflow: wf, status, abortController, promise };
    this.activeRuns.set(name, run);

    // Emit started event
    this.emitWorkflowEvent(name, "started");

    try {
      await promise;
    } finally {
      this.activeRuns.delete(name);
    }
  }

  /**
   * Cancel a running workflow
   */
  async cancelWorkflow(name: string): Promise<void> {
    const run = this.activeRuns.get(name);
    if (!run) {
      throw new Error(`Workflow "${name}" is not running`);
    }

    run.abortController.abort();
    run.status.status = "cancelled";
    run.status.completedAt = Date.now();

    // Emit cancelled event
    this.emitWorkflowEvent(name, "cancelled");

    logger.info("Workflow cancelled", { name });
  }

  /**
   * Get status of one or all workflows
   */
  getStatus(name?: string): WorkflowStatus | WorkflowStatus[] {
    if (name) {
      const wf = this.workflows.get(name);
      if (!wf) {
        throw new Error(`Workflow "${name}" not found`);
      }
      return this.buildStatus(wf);
    }

    return Array.from(this.workflows.values()).map((wf) => this.buildStatus(wf));
  }

  /**
   * List all workflow names
   */
  listWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }

  // --- Private methods ---

  private buildStatus(wf: WorkflowItem): WorkflowStatus {
    const active = this.activeRuns.get(wf.name);
    return {
      name: wf.name,
      manual: wf.manual ?? false,
      trigger_on: wf.trigger_on ?? [],
      on_failure: wf.on_failure ?? "abort",
      timeout_ms: wf.timeout_ms ?? DEFAULT_WORKFLOW_TIMEOUT_MS,
      stepCount: wf.steps.length,
      active: active?.status,
    };
  }

  private async executeWorkflow(
    wf: WorkflowItem,
    status: WorkflowRunStatus,
    abortController: AbortController,
  ): Promise<void> {
    const workflowTimeout = wf.timeout_ms ?? DEFAULT_WORKFLOW_TIMEOUT_MS;
    const workflowTimer = setTimeout(() => {
      abortController.abort();
    }, workflowTimeout);

    try {
      for (let i = 0; i < wf.steps.length; i++) {
        if (abortController.signal.aborted) {
          // Mark remaining steps as skipped
          for (let j = i; j < wf.steps.length; j++) {
            if (status.steps[j]!.status === "pending") {
              status.steps[j]!.status = "skipped";
            }
          }
          break;
        }

        status.currentStep = i;
        const step = wf.steps[i]!;
        const stepState = status.steps[i]!;

        // Evaluate condition
        if (step.if) {
          const conditionMet = this.evaluateCondition(step.if);
          if (!conditionMet) {
            stepState.status = "skipped";
            logger.debug("Step skipped due to condition", {
              workflow: wf.name,
              step: i,
              action: step.action,
            });
            continue;
          }
        }

        stepState.status = "running";
        stepState.startedAt = Date.now();

        try {
          await this.executeStep(step, abortController.signal);
          stepState.status = "completed";
          stepState.completedAt = Date.now();
        } catch (error) {
          stepState.status = "failed";
          stepState.completedAt = Date.now();
          stepState.error = error instanceof Error ? error.message : String(error);

          const failureAction = step.on_failure ?? wf.on_failure ?? "abort";

          logger.error("Workflow step failed", {
            workflow: wf.name,
            step: i,
            action: step.action,
            error: stepState.error,
            failureAction,
          });

          if (failureAction === "abort") {
            status.status = "failed";
            status.completedAt = Date.now();
            status.error = `Step ${i} (${step.action}) failed: ${stepState.error}`;

            // Mark remaining steps as skipped
            for (let j = i + 1; j < wf.steps.length; j++) {
              status.steps[j]!.status = "skipped";
            }

            this.emitWorkflowEvent(wf.name, "failed", { error: status.error });
            return;
          } else if (failureAction === "skip_rest") {
            for (let j = i + 1; j < wf.steps.length; j++) {
              status.steps[j]!.status = "skipped";
            }
            break;
          }
          // "continue" — just move to next step
        }
      }

      // If we get here without being set to failed/cancelled
      if (status.status === "running") {
        status.status = abortController.signal.aborted ? "cancelled" : "completed";
        status.completedAt = Date.now();

        if (status.status === "completed") {
          this.emitWorkflowEvent(wf.name, "completed");
        } else {
          status.error = "Workflow timed out";
          this.emitWorkflowEvent(wf.name, "failed", { error: status.error });
        }
      }
    } finally {
      clearTimeout(workflowTimer);
    }
  }

  private async executeStep(step: WorkflowStep, signal: AbortSignal): Promise<void> {
    switch (step.action) {
      case "run": {
        // Trigger the process via orchestrator
        await this.orchestrator.triggerStage(step.process!);

        // Determine default await event
        let awaitEvent = step.await;
        if (!awaitEvent) {
          // Default: tasks auto-await success, services don't
          const procStatus = this.processManager.getStatus(step.process!);
          if (procStatus?.type === "task") {
            awaitEvent = `${step.process}:success`;
          }
        }

        if (awaitEvent) {
          await this.awaitEvent(awaitEvent, step.timeout_ms, signal);
        }
        break;
      }

      case "stop": {
        if (this.processManager.isRunning(step.process!)) {
          await this.processManager.stopProcess(step.process!);
        }
        break;
      }

      case "start": {
        await this.orchestrator.triggerStage(step.process!);
        if (step.await) {
          await this.awaitEvent(step.await, step.timeout_ms, signal);
        }
        break;
      }

      case "restart": {
        if (this.processManager.isRunning(step.process!)) {
          await this.processManager.restartProcess(step.process!);
        } else {
          await this.orchestrator.triggerStage(step.process!);
        }
        if (step.await) {
          await this.awaitEvent(step.await, step.timeout_ms, signal);
        }
        break;
      }

      case "await": {
        await this.awaitEvent(step.event!, step.timeout_ms, signal);
        break;
      }

      case "emit": {
        const event: ClierEvent = {
          name: step.event!,
          processName: "workflow",
          type: "custom",
          data: step.data,
          timestamp: Date.now(),
        };
        this.eventHandler.emit(step.event!, event);
        break;
      }

      default:
        throw new Error(`Unknown workflow step action: ${(step as WorkflowStep).action}`);
    }
  }

  private awaitEvent(
    eventName: string,
    timeoutMs: number | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = timeoutMs ?? 0;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        this.eventHandler.off(eventName, handler);
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };

      const handler: EventHandlerFn = () => {
        cleanup();
        resolve();
      };

      const onAbort = () => {
        cleanup();
        reject(new Error("Workflow cancelled"));
      };

      if (signal.aborted) {
        reject(new Error("Workflow cancelled"));
        return;
      }

      signal.addEventListener("abort", onAbort);
      this.eventHandler.on(eventName, handler);

      if (timeout > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timeout waiting for event "${eventName}" after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  private evaluateCondition(condition: WorkflowCondition): boolean {
    if ("process" in condition && "is" in condition) {
      const status = this.processManager.getStatus(condition.process);
      if (!status) {
        // Process not found — treat as stopped
        return condition.is === "stopped";
      }
      return status.status === condition.is;
    }

    if ("not" in condition) {
      return !this.evaluateCondition(condition.not);
    }

    if ("all" in condition) {
      return condition.all.every((c) => this.evaluateCondition(c));
    }

    if ("any" in condition) {
      return condition.any.some((c) => this.evaluateCondition(c));
    }

    return false;
  }

  private emitWorkflowEvent(
    name: string,
    suffix: "started" | "completed" | "failed" | "cancelled",
    data?: Record<string, unknown>,
  ): void {
    const eventName = `${name}:${suffix}`;
    const event: ClierEvent = {
      name: eventName,
      processName: name,
      type: suffix === "completed" ? "success" : suffix === "failed" ? "error" : "custom",
      data,
      timestamp: Date.now(),
    };

    logger.info("Emitting workflow event", { eventName });
    this.eventHandler.emit(eventName, event);
  }
}
