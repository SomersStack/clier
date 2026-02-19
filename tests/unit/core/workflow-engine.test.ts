import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkflowEngine } from "../../../src/core/workflow-engine.js";
import type { WorkflowItem } from "../../../src/config/types.js";
import type { ProcessManager } from "../../../src/core/process-manager.js";
import type { EventHandler } from "../../../src/core/event-handler.js";
import type { Orchestrator } from "../../../src/core/orchestrator.js";
import type { EventHandlerFn } from "../../../src/types/events.js";

// --- Mocks ---

function createMockProcessManager(): ProcessManager {
  const mock = {
    getStatus: vi.fn().mockReturnValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
    isAnyInstanceRunning: vi.fn().mockImplementation((name: string) => {
      const status = mock.getStatus(name);
      return status?.status === "running";
    }),
    stopProcess: vi.fn().mockResolvedValue(undefined),
    stopAllInstances: vi.fn().mockResolvedValue(undefined),
    restartProcess: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProcessManager;
  return mock;
}

function createMockEventHandler(): EventHandler {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as EventHandler;
}

function createMockOrchestrator(): Orchestrator {
  return {
    triggerStage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Orchestrator;
}

// --- Helpers ---

function createWorkflow(overrides?: Partial<WorkflowItem>): WorkflowItem {
  return {
    name: "test-workflow",
    type: "workflow",
    steps: [
      { action: "run", process: "backend" },
    ],
    ...overrides,
  };
}

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;
  let processManager: ProcessManager;
  let eventHandler: EventHandler;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    processManager = createMockProcessManager();
    eventHandler = createMockEventHandler();
    orchestrator = createMockOrchestrator();
    engine = new WorkflowEngine(processManager, eventHandler, orchestrator);
  });

  describe("loadWorkflows", () => {
    it("should register workflows correctly", () => {
      const wf1 = createWorkflow({ name: "wf1" });
      const wf2 = createWorkflow({ name: "wf2" });

      engine.loadWorkflows([wf1, wf2]);

      expect(engine.listWorkflows()).toEqual(["wf1", "wf2"]);
    });

    it("should clear previous workflows on reload", () => {
      engine.loadWorkflows([createWorkflow({ name: "old" })]);
      engine.loadWorkflows([createWorkflow({ name: "new" })]);

      expect(engine.listWorkflows()).toEqual(["new"]);
    });

    it("should initialize trigger tracking for event-triggered workflows", () => {
      const wf = createWorkflow({
        name: "triggered",
        trigger_on: ["backend:ready"],
        manual: false,
      });

      engine.loadWorkflows([wf]);

      // Verify the workflow is registered and can be listed
      expect(engine.listWorkflows()).toContain("triggered");
    });

    it("should not initialize trigger tracking for manual workflows", () => {
      const wf = createWorkflow({
        name: "manual-wf",
        trigger_on: ["backend:ready"],
        manual: true,
      });

      engine.loadWorkflows([wf]);

      // handleEvent should not trigger manual workflows
      engine.handleEvent({
        name: "backend:ready",
        processName: "backend",
        type: "custom",
        timestamp: Date.now(),
      });

      // No triggerStage call should happen since it's manual
      expect(orchestrator.triggerStage).not.toHaveBeenCalled();
    });
  });

  describe("triggerWorkflow", () => {
    it("should throw for unknown workflow", async () => {
      await expect(engine.triggerWorkflow("nonexistent")).rejects.toThrow(
        'Workflow "nonexistent" not found',
      );
    });

    it("should execute steps sequentially and emit started/completed events", async () => {
      // Use a service type so "run" doesn't auto-await
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "running",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "seq-wf",
        steps: [
          { action: "run", process: "backend" },
          { action: "run", process: "frontend" },
        ],
      });

      // For frontend, also return service so no auto-await
      vi.mocked(processManager.getStatus).mockImplementation((name: string) => ({
        name,
        type: "service",
        status: "running",
        uptime: 0,
        restarts: 0,
      }));

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("seq-wf");

      // Both steps should have triggered
      expect(orchestrator.triggerStage).toHaveBeenCalledWith("backend");
      expect(orchestrator.triggerStage).toHaveBeenCalledWith("frontend");

      // Should emit started and completed events
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "seq-wf:started",
        expect.objectContaining({ name: "seq-wf:started" }),
      );
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "seq-wf:completed",
        expect.objectContaining({ name: "seq-wf:completed" }),
      );
    });

    it("should auto-await task success for 'run' step", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "build",
        type: "task",
        status: "running",
        uptime: 0,
        restarts: 0,
      });

      // Capture the event handler registered for build:success
      let capturedHandler: EventHandlerFn | undefined;
      vi.mocked(eventHandler.on).mockImplementation((event: string, handler: EventHandlerFn) => {
        if (event === "build:success") {
          capturedHandler = handler;
          // Simulate event arriving immediately
          Promise.resolve().then(() => {
            handler({
              name: "build:success",
              processName: "build",
              type: "success",
              timestamp: Date.now(),
            });
          });
        }
      });

      const wf = createWorkflow({
        name: "task-wf",
        steps: [{ action: "run", process: "build" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("task-wf");

      expect(orchestrator.triggerStage).toHaveBeenCalledWith("build");
      expect(eventHandler.on).toHaveBeenCalledWith("build:success", expect.any(Function));
      expect(capturedHandler).toBeDefined();
    });

    it("should execute 'stop' step", async () => {
      vi.mocked(processManager.isRunning).mockReturnValue(true);

      const wf = createWorkflow({
        name: "stop-wf",
        steps: [{ action: "stop", process: "backend" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("stop-wf");

      expect(processManager.isRunning).toHaveBeenCalledWith("backend");
      expect(processManager.stopProcess).toHaveBeenCalledWith("backend");
    });

    it("should skip 'stop' when process is not running", async () => {
      vi.mocked(processManager.isRunning).mockReturnValue(false);

      const wf = createWorkflow({
        name: "stop-noop-wf",
        steps: [{ action: "stop", process: "backend" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("stop-noop-wf");

      expect(processManager.stopProcess).not.toHaveBeenCalled();
    });

    it("should execute 'start' step via orchestrator", async () => {
      const wf = createWorkflow({
        name: "start-wf",
        steps: [{ action: "start", process: "backend" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("start-wf");

      expect(orchestrator.triggerStage).toHaveBeenCalledWith("backend");
    });

    it("should execute 'start' step with await", async () => {
      vi.mocked(eventHandler.on).mockImplementation((event: string, handler: EventHandlerFn) => {
        if (event === "backend:ready") {
          Promise.resolve().then(() => {
            handler({
              name: "backend:ready",
              processName: "backend",
              type: "custom",
              timestamp: Date.now(),
            });
          });
        }
      });

      const wf = createWorkflow({
        name: "start-await-wf",
        steps: [{ action: "start", process: "backend", await: "backend:ready" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("start-await-wf");

      expect(orchestrator.triggerStage).toHaveBeenCalledWith("backend");
      expect(eventHandler.on).toHaveBeenCalledWith("backend:ready", expect.any(Function));
    });

    it("should execute 'restart' step - restart when running", async () => {
      vi.mocked(processManager.isRunning).mockReturnValue(true);

      const wf = createWorkflow({
        name: "restart-wf",
        steps: [{ action: "restart", process: "backend" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("restart-wf");

      expect(processManager.restartProcess).toHaveBeenCalledWith("backend");
    });

    it("should execute 'restart' step - start via orchestrator when not running", async () => {
      vi.mocked(processManager.isRunning).mockReturnValue(false);

      const wf = createWorkflow({
        name: "restart-start-wf",
        steps: [{ action: "restart", process: "backend" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("restart-start-wf");

      expect(processManager.restartProcess).not.toHaveBeenCalled();
      expect(orchestrator.triggerStage).toHaveBeenCalledWith("backend");
    });

    it("should execute 'emit' step", async () => {
      const wf = createWorkflow({
        name: "emit-wf",
        steps: [{ action: "emit", event: "custom:event", data: { key: "value" } }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("emit-wf");

      expect(eventHandler.emit).toHaveBeenCalledWith(
        "custom:event",
        expect.objectContaining({
          name: "custom:event",
          processName: "workflow",
          type: "custom",
          data: { key: "value" },
        }),
      );
    });

    it("should execute 'await' step", async () => {
      vi.mocked(eventHandler.on).mockImplementation((event: string, handler: EventHandlerFn) => {
        if (event === "build:done") {
          Promise.resolve().then(() => {
            handler({
              name: "build:done",
              processName: "build",
              type: "custom",
              timestamp: Date.now(),
            });
          });
        }
      });

      const wf = createWorkflow({
        name: "await-wf",
        steps: [{ action: "await", event: "build:done" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("await-wf");

      expect(eventHandler.on).toHaveBeenCalledWith("build:done", expect.any(Function));
    });
  });

  describe("Condition evaluation", () => {
    it("should evaluate process running condition", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "running",
        uptime: 1000,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "cond-running",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: { process: "backend", is: "running" },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-running");

      // The emit step should have executed since condition is met
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });

    it("should evaluate process stopped condition", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "stopped",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "cond-stopped",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: { process: "backend", is: "stopped" },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-stopped");

      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });

    it("should evaluate process crashed condition", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "crashed",
        uptime: 0,
        restarts: 3,
      });

      const wf = createWorkflow({
        name: "cond-crashed",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: { process: "backend", is: "crashed" },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-crashed");

      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });

    it("should treat unknown process as stopped", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue(undefined);

      const wf = createWorkflow({
        name: "cond-unknown",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: { process: "nonexistent", is: "stopped" },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-unknown");

      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });

    it("should evaluate 'not' condition", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "running",
        uptime: 1000,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "cond-not",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: { not: { process: "backend", is: "stopped" } },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-not");

      // backend is running, not stopped is true => step should execute
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });

    it("should evaluate 'all' condition", async () => {
      vi.mocked(processManager.getStatus).mockImplementation((name: string) => ({
        name,
        type: "service" as const,
        status: "running" as const,
        uptime: 1000,
        restarts: 0,
      }));

      const wf = createWorkflow({
        name: "cond-all",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: {
              all: [
                { process: "backend", is: "running" },
                { process: "frontend", is: "running" },
              ],
            },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-all");

      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });

    it("should evaluate 'all' condition as false when one fails", async () => {
      vi.mocked(processManager.getStatus).mockImplementation((name: string) => ({
        name,
        type: "service" as const,
        status: name === "backend" ? ("running" as const) : ("stopped" as const),
        uptime: 0,
        restarts: 0,
      }));

      const wf = createWorkflow({
        name: "cond-all-false",
        steps: [
          {
            action: "emit",
            event: "step:should-skip",
            if: {
              all: [
                { process: "backend", is: "running" },
                { process: "frontend", is: "running" },
              ],
            },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-all-false");

      // The step:should-skip emit should NOT have been called (only workflow events)
      const emitCalls = vi.mocked(eventHandler.emit).mock.calls;
      const stepEmitCalls = emitCalls.filter(([name]) => name === "step:should-skip");
      expect(stepEmitCalls).toHaveLength(0);
    });

    it("should evaluate 'any' condition", async () => {
      vi.mocked(processManager.getStatus).mockImplementation((name: string) => ({
        name,
        type: "service" as const,
        status: name === "backend" ? ("running" as const) : ("stopped" as const),
        uptime: 0,
        restarts: 0,
      }));

      const wf = createWorkflow({
        name: "cond-any",
        steps: [
          {
            action: "emit",
            event: "step:reached",
            if: {
              any: [
                { process: "backend", is: "running" },
                { process: "frontend", is: "running" },
              ],
            },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("cond-any");

      // backend is running, so 'any' is true
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "step:reached",
        expect.objectContaining({ name: "step:reached" }),
      );
    });
  });

  describe("Step skipping with 'if' condition", () => {
    it("should skip step when 'if' condition is false", async () => {
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "stopped",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "skip-wf",
        steps: [
          {
            action: "stop",
            process: "backend",
            if: { process: "backend", is: "running" },
          },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("skip-wf");

      // stop should not have been called because condition is false
      expect(processManager.stopProcess).not.toHaveBeenCalled();
    });
  });

  describe("on_failure handling", () => {
    it("should abort workflow on step failure when on_failure is 'abort'", async () => {
      vi.mocked(orchestrator.triggerStage).mockRejectedValueOnce(new Error("start failed"));

      // Return service type so no auto-await
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "stopped",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "abort-wf",
        on_failure: "abort",
        steps: [
          { action: "run", process: "backend" },
          { action: "emit", event: "should-not-reach" },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("abort-wf");

      // Second step should not execute
      const emitCalls = vi.mocked(eventHandler.emit).mock.calls;
      const reachCalls = emitCalls.filter(([name]) => name === "should-not-reach");
      expect(reachCalls).toHaveLength(0);

      // Should emit failed event
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "abort-wf:failed",
        expect.objectContaining({ name: "abort-wf:failed" }),
      );
    });

    it("should continue to next step when on_failure is 'continue'", async () => {
      vi.mocked(orchestrator.triggerStage).mockRejectedValueOnce(new Error("start failed"));

      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "stopped",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "continue-wf",
        on_failure: "continue",
        steps: [
          { action: "run", process: "backend" },
          { action: "emit", event: "should-reach" },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("continue-wf");

      // Second step should execute
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "should-reach",
        expect.objectContaining({ name: "should-reach" }),
      );
    });

    it("should skip remaining steps when on_failure is 'skip_rest'", async () => {
      vi.mocked(orchestrator.triggerStage).mockRejectedValueOnce(new Error("start failed"));

      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "backend",
        type: "service",
        status: "stopped",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "skip-rest-wf",
        on_failure: "skip_rest",
        steps: [
          { action: "run", process: "backend" },
          { action: "emit", event: "should-not-reach" },
        ],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("skip-rest-wf");

      const emitCalls = vi.mocked(eventHandler.emit).mock.calls;
      const reachCalls = emitCalls.filter(([name]) => name === "should-not-reach");
      expect(reachCalls).toHaveLength(0);

      // Should emit completed (not failed) since skip_rest doesn't set status to failed
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "skip-rest-wf:completed",
        expect.objectContaining({ name: "skip-rest-wf:completed" }),
      );
    });
  });

  describe("cancelWorkflow", () => {
    it("should abort a running workflow", async () => {
      // Create a workflow that waits for an event (will hang until cancelled)
      const wf = createWorkflow({
        name: "cancel-wf",
        steps: [{ action: "await", event: "never:arriving" }],
      });

      engine.loadWorkflows([wf]);

      // Start the workflow (don't await - it will block on the await step)
      const promise = engine.triggerWorkflow("cancel-wf");

      // Give it a tick to start
      await new Promise((r) => setTimeout(r, 10));

      // Cancel it
      await engine.cancelWorkflow("cancel-wf");

      // The trigger promise should resolve (workflow was cancelled)
      await promise;

      expect(eventHandler.emit).toHaveBeenCalledWith(
        "cancel-wf:cancelled",
        expect.objectContaining({ name: "cancel-wf:cancelled" }),
      );
    });

    it("should throw when cancelling a non-running workflow", async () => {
      await expect(engine.cancelWorkflow("nonexistent")).rejects.toThrow(
        'Workflow "nonexistent" is not running',
      );
    });
  });

  describe("Reject triggering an already-running workflow", () => {
    it("should reject triggering a workflow that is already running", async () => {
      const wf = createWorkflow({
        name: "dup-wf",
        steps: [{ action: "await", event: "never:arriving" }],
      });

      engine.loadWorkflows([wf]);

      // Start the workflow (don't await)
      const firstRun = engine.triggerWorkflow("dup-wf");

      // Give it a tick to start
      await new Promise((r) => setTimeout(r, 10));

      // Second trigger should fail
      await expect(engine.triggerWorkflow("dup-wf")).rejects.toThrow(
        'Workflow "dup-wf" is already running',
      );

      // Cancel to clean up
      await engine.cancelWorkflow("dup-wf");
      await firstRun;
    });
  });

  describe("handleEvent", () => {
    it("should trigger workflow when all trigger_on events are received", async () => {
      // Return service type for the run step to avoid auto-await
      vi.mocked(processManager.getStatus).mockReturnValue({
        name: "deploy",
        type: "service",
        status: "stopped",
        uptime: 0,
        restarts: 0,
      });

      const wf = createWorkflow({
        name: "multi-trigger",
        trigger_on: ["build:done", "test:done"],
        steps: [{ action: "run", process: "deploy" }],
      });

      engine.loadWorkflows([wf]);

      // Send first event - should not trigger yet
      engine.handleEvent({
        name: "build:done",
        processName: "build",
        type: "success",
        timestamp: Date.now(),
      });

      // Give a tick
      await new Promise((r) => setTimeout(r, 10));
      expect(orchestrator.triggerStage).not.toHaveBeenCalled();

      // Send second event - should trigger now
      engine.handleEvent({
        name: "test:done",
        processName: "test",
        type: "success",
        timestamp: Date.now(),
      });

      // Give time for the async trigger
      await new Promise((r) => setTimeout(r, 50));

      expect(orchestrator.triggerStage).toHaveBeenCalledWith("deploy");
    });

    it("should not trigger manual workflows via events", () => {
      const wf = createWorkflow({
        name: "manual-wf",
        trigger_on: ["build:done"],
        manual: true,
        steps: [{ action: "emit", event: "should-not-fire" }],
      });

      engine.loadWorkflows([wf]);

      engine.handleEvent({
        name: "build:done",
        processName: "build",
        type: "success",
        timestamp: Date.now(),
      });

      // No step should have been executed
      const emitCalls = vi.mocked(eventHandler.emit).mock.calls;
      const fireCalls = emitCalls.filter(([name]) => name === "should-not-fire");
      expect(fireCalls).toHaveLength(0);
    });
  });

  describe("Step timeout", () => {
    it("should reject await step when timeout expires", async () => {
      // Don't resolve the event - let it time out
      const wf = createWorkflow({
        name: "timeout-step-wf",
        on_failure: "abort",
        steps: [{ action: "await", event: "slow:event", timeout_ms: 50 }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("timeout-step-wf");

      // Should have emitted failed event due to timeout
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "timeout-step-wf:failed",
        expect.objectContaining({ name: "timeout-step-wf:failed" }),
      );
    });
  });

  describe("Workflow-level timeout", () => {
    it("should cancel workflow when workflow timeout expires", async () => {
      // Create a workflow with a very short timeout that awaits an event that never comes
      const wf = createWorkflow({
        name: "wf-timeout",
        timeout_ms: 50,
        steps: [{ action: "await", event: "never:arriving" }],
      });

      engine.loadWorkflows([wf]);
      await engine.triggerWorkflow("wf-timeout");

      // Should have emitted failed event with timeout
      expect(eventHandler.emit).toHaveBeenCalledWith(
        "wf-timeout:failed",
        expect.objectContaining({ name: "wf-timeout:failed" }),
      );
    });
  });

  describe("getStatus", () => {
    it("should return status of a specific workflow", () => {
      const wf = createWorkflow({
        name: "status-wf",
        manual: true,
        on_failure: "continue",
        timeout_ms: 5000,
      });

      engine.loadWorkflows([wf]);

      const status = engine.getStatus("status-wf");
      expect(status).toEqual(
        expect.objectContaining({
          name: "status-wf",
          manual: true,
          on_failure: "continue",
          timeout_ms: 5000,
          stepCount: 1,
        }),
      );
    });

    it("should return status of all workflows", () => {
      engine.loadWorkflows([
        createWorkflow({ name: "wf1" }),
        createWorkflow({ name: "wf2" }),
      ]);

      const statuses = engine.getStatus();
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses).toHaveLength(2);
    });

    it("should throw for unknown workflow name", () => {
      expect(() => engine.getStatus("nonexistent")).toThrow(
        'Workflow "nonexistent" not found',
      );
    });
  });
});
