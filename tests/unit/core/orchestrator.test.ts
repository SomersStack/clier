import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Orchestrator } from "../../../src/core/orchestrator.js";
import { ProcessManager } from "../../../src/core/process-manager.js";
import type { ClierConfig, PipelineItem } from "../../../src/config/types.js";
import type { ClierEvent } from "../../../src/types/events.js";

// Mock ProcessManager
vi.mock("../../../src/core/process-manager.js");

describe("Orchestrator", () => {
  let orchestrator: Orchestrator;
  let mockProcessManager: ProcessManager;

  const createConfig = (pipeline: PipelineItem[]): ClierConfig => ({
    project_name: "test-project",
    global_env: true,
    safety: {
      max_ops_per_minute: 60,
      debounce_ms: 100,
    },
    pipeline,
  });

  const createPipelineItem = (
    overrides?: Partial<PipelineItem>,
  ): PipelineItem => ({
    name: "test-process",
    command: "npm test",
    type: "task",
    events: {
      on_stdout: [],
      on_stderr: true,
      on_crash: true,
    },
    ...overrides,
  });

  beforeEach(() => {
    mockProcessManager = new ProcessManager();
    mockProcessManager.startProcess = vi.fn().mockResolvedValue(undefined);
    mockProcessManager.stopProcess = vi.fn().mockResolvedValue(undefined);
    mockProcessManager.isProcessRunning = vi.fn().mockResolvedValue(false);

    orchestrator = new Orchestrator(mockProcessManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("loadPipeline", () => {
    it("should load pipeline configuration", () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).not.toThrow();
    });

    it("should identify entry points (no trigger_on)", () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "database" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);

      const entryPoints = orchestrator.getEntryPoints();
      expect(entryPoints).toHaveLength(2);
      expect(entryPoints.map((p) => p.name)).toContain("backend");
      expect(entryPoints.map((p) => p.name)).toContain("database");
    });
  });

  describe("start", () => {
    it("should start all entry point processes", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend", type: "service" }),
        createPipelineItem({ name: "database", type: "service" }),
        createPipelineItem({
          name: "frontend",
          type: "service",
          trigger_on: ["backend:ready"],
        }),
      ]);

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      expect(mockProcessManager.startProcess).toHaveBeenCalledTimes(2);
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "backend" }),
      );
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "database" }),
      );
    });

    it("should not start processes with trigger_on", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      expect(mockProcessManager.startProcess).toHaveBeenCalledOnce();
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "backend" }),
      );
    });

    it("should handle errors when starting processes", async () => {
      const config = createConfig([createPipelineItem({ name: "backend" })]);

      mockProcessManager.startProcess = vi
        .fn()
        .mockRejectedValue(new Error("Start failed"));

      orchestrator.loadPipeline(config);

      await expect(orchestrator.start()).rejects.toThrow("Start failed");
    });
  });

  describe("handleEvent - trigger dependencies", () => {
    it("should start dependent process when trigger event is received", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "backend:ready",
        processName: "backend",
        type: "custom",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "frontend" }),
      );
    });

    it("should start multiple dependents for same trigger", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
        createPipelineItem({ name: "admin", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "backend:ready",
        processName: "backend",
        type: "custom",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledTimes(2);
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "frontend" }),
      );
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "admin" }),
      );
    });

    it("should handle process with multiple triggers", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "database" }),
        createPipelineItem({
          name: "frontend",
          trigger_on: ["backend:ready", "database:ready"],
        }),
      ]);

      orchestrator.loadPipeline(config);

      // First trigger
      await orchestrator.handleEvent({
        name: "backend:ready",
        processName: "backend",
        type: "custom",
        timestamp: Date.now(),
      });

      // Frontend should wait for both triggers
      expect(mockProcessManager.startProcess).not.toHaveBeenCalled();

      // Second trigger
      await orchestrator.handleEvent({
        name: "database:ready",
        processName: "database",
        type: "custom",
        timestamp: Date.now(),
      });

      // Now frontend should start
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "frontend" }),
      );
    });

    it("should not start process multiple times when all triggers met", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "backend:ready",
        processName: "backend",
        type: "custom",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(event);
      await orchestrator.handleEvent(event); // Same event again

      // Should only start once
      expect(mockProcessManager.startProcess).toHaveBeenCalledOnce();
    });
  });

  describe("handleEvent - continue_on_failure", () => {
    it("should not trigger dependents on failure when continue_on_failure is false", async () => {
      const config = createConfig([
        createPipelineItem({
          name: "build",
          type: "task",
          continue_on_failure: false,
        }),
        createPipelineItem({ name: "deploy", trigger_on: ["build:success"] }),
      ]);

      orchestrator.loadPipeline(config);

      // Build fails
      const failureEvent: ClierEvent = {
        name: "build:error",
        processName: "build",
        type: "error",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(failureEvent);

      // Deploy should not be triggered
      expect(mockProcessManager.startProcess).not.toHaveBeenCalled();
    });

    it("should trigger dependents on failure when continue_on_failure is true", async () => {
      const config = createConfig([
        createPipelineItem({
          name: "build",
          type: "task",
          continue_on_failure: true,
        }),
        createPipelineItem({ name: "cleanup", trigger_on: ["build:error"] }),
      ]);

      orchestrator.loadPipeline(config);

      // Build fails
      const failureEvent: ClierEvent = {
        name: "build:error",
        processName: "build",
        type: "error",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(failureEvent);

      // Cleanup should be triggered
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "cleanup" }),
      );
    });

    it("should trigger dependents on crash when continue_on_failure is true", async () => {
      const config = createConfig([
        createPipelineItem({
          name: "backend",
          type: "service",
          continue_on_failure: true,
        }),
        createPipelineItem({ name: "alert", trigger_on: ["backend:crashed"] }),
      ]);

      orchestrator.loadPipeline(config);

      // Backend crashes
      const crashEvent: ClierEvent = {
        name: "backend:crashed",
        processName: "backend",
        type: "crashed",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(crashEvent);

      // Alert should be triggered
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ name: "alert" }),
      );
    });
  });

  describe("ProcessConfig generation", () => {
    it("should generate correct ProcessConfig for service", async () => {
      const config = createConfig([
        createPipelineItem({
          name: "backend",
          command: "npm start",
          type: "service",
          cwd: "/app/backend",
          env: { PORT: "3000", NODE_ENV: "production" },
        }),
      ]);

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "backend",
          command: "npm start",
          cwd: "/app/backend",
          type: "service",
          restart: expect.objectContaining({
            enabled: true,
          }),
          env: expect.objectContaining({
            PORT: "3000",
            NODE_ENV: "production",
          }),
        }),
      );
    });

    it("should generate correct ProcessConfig for task", async () => {
      const config = createConfig([
        createPipelineItem({
          name: "build",
          command: "npm run build",
          type: "task",
          cwd: "/app",
        }),
      ]);

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "build",
          command: "npm run build",
          cwd: "/app",
          type: "task",
        }),
      );
    });

    it("should merge global_env when enabled", async () => {
      // Set some env vars for testing
      process.env["GLOBAL_VAR"] = "global-value";

      const config = createConfig([
        createPipelineItem({
          name: "backend",
          command: "npm start",
          type: "service",
          env: { PORT: "3000" },
        }),
      ]);

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            PORT: "3000",
            GLOBAL_VAR: "global-value",
          }),
        }),
      );

      // Cleanup
      delete process.env["GLOBAL_VAR"];
    });

    it("should not merge global_env when disabled", async () => {
      process.env["GLOBAL_VAR"] = "global-value";

      const config: ClierConfig = {
        project_name: "test-project",
        global_env: false,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          createPipelineItem({
            name: "backend",
            command: "npm start",
            type: "service",
            env: { PORT: "3000" },
          }),
        ],
      };

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { PORT: "3000" },
        }),
      );

      delete process.env["GLOBAL_VAR"];
    });
  });

  describe("getWaitingProcesses", () => {
    it("should return processes waiting for triggers", () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
        createPipelineItem({
          name: "admin",
          trigger_on: ["backend:ready", "db:ready"],
        }),
      ]);

      orchestrator.loadPipeline(config);

      const waiting = orchestrator.getWaitingProcesses();
      expect(waiting).toHaveLength(2);
      expect(waiting.map((p) => p.name)).toContain("frontend");
      expect(waiting.map((p) => p.name)).toContain("admin");
    });

    it("should return empty array when all processes started", async () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);

      await orchestrator.handleEvent({
        name: "backend:ready",
        processName: "backend",
        type: "custom",
        timestamp: Date.now(),
      });

      const waiting = orchestrator.getWaitingProcesses();
      expect(waiting).toHaveLength(0);
    });
  });

  describe("getEntryPoints", () => {
    it("should return processes without triggers", () => {
      const config = createConfig([
        createPipelineItem({ name: "backend" }),
        createPipelineItem({ name: "database" }),
        createPipelineItem({ name: "frontend", trigger_on: ["backend:ready"] }),
      ]);

      orchestrator.loadPipeline(config);

      const entryPoints = orchestrator.getEntryPoints();
      expect(entryPoints).toHaveLength(2);
      expect(entryPoints.map((p) => p.name)).toContain("backend");
      expect(entryPoints.map((p) => p.name)).toContain("database");
    });
  });

  describe("circular dependency detection", () => {
    it("should throw on direct circular dependency (A → B → A)", () => {
      const config = createConfig([
        createPipelineItem({
          name: "a",
          events: {
            on_stdout: [{ pattern: "ready", emit: "a:ready" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["b:ready"],
        }),
        createPipelineItem({
          name: "b",
          events: {
            on_stdout: [{ pattern: "ready", emit: "b:ready" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["a:ready"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).toThrow(
        /Circular dependency detected in pipeline/
      );
    });

    it("should throw on indirect circular dependency (A → B → C → A)", () => {
      const config = createConfig([
        createPipelineItem({
          name: "a",
          events: {
            on_stdout: [{ pattern: "ready", emit: "a:ready" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["c:ready"],
        }),
        createPipelineItem({
          name: "b",
          events: {
            on_stdout: [{ pattern: "ready", emit: "b:ready" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["a:ready"],
        }),
        createPipelineItem({
          name: "c",
          events: {
            on_stdout: [{ pattern: "ready", emit: "c:ready" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["b:ready"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).toThrow(
        /Circular dependency detected in pipeline/
      );
    });

    it("should throw on self-referencing process", () => {
      const config = createConfig([
        createPipelineItem({
          name: "loop",
          events: {
            on_stdout: [{ pattern: "go", emit: "loop:go" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["loop:go"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).toThrow(
        /Circular dependency detected in pipeline.*loop → loop/
      );
    });

    it("should include cycle path in error message", () => {
      const config = createConfig([
        createPipelineItem({
          name: "alpha",
          events: {
            on_stdout: [{ pattern: "done", emit: "alpha:done" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["beta:done"],
        }),
        createPipelineItem({
          name: "beta",
          events: {
            on_stdout: [{ pattern: "done", emit: "beta:done" }],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["alpha:done"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).toThrow(
        /alpha → beta → alpha|beta → alpha → beta/
      );
    });

    it("should NOT throw for valid DAG pipelines", () => {
      const config = createConfig([
        createPipelineItem({
          name: "backend",
          events: {
            on_stdout: [{ pattern: "ready", emit: "backend:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        }),
        createPipelineItem({
          name: "frontend",
          trigger_on: ["backend:ready"],
        }),
        createPipelineItem({
          name: "admin",
          trigger_on: ["backend:ready"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).not.toThrow();
    });

    it("should NOT throw for diamond dependencies (A → B,C → D)", () => {
      const config = createConfig([
        createPipelineItem({
          name: "a",
          events: {
            on_stdout: [{ pattern: "ready", emit: "a:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        }),
        createPipelineItem({
          name: "b",
          trigger_on: ["a:ready"],
          events: {
            on_stdout: [{ pattern: "ready", emit: "b:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        }),
        createPipelineItem({
          name: "c",
          trigger_on: ["a:ready"],
          events: {
            on_stdout: [{ pattern: "ready", emit: "c:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        }),
        createPipelineItem({
          name: "d",
          trigger_on: ["b:ready", "c:ready"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).not.toThrow();
    });

    it("should detect cycle via built-in exit events", () => {
      const config = createConfig([
        createPipelineItem({
          name: "worker",
          events: {
            on_stdout: [],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["cleanup:exit"],
        }),
        createPipelineItem({
          name: "cleanup",
          events: {
            on_stdout: [],
            on_stderr: true,
            on_crash: true,
          },
          trigger_on: ["worker:exit"],
        }),
      ]);

      expect(() => orchestrator.loadPipeline(config)).toThrow(
        /Circular dependency detected in pipeline/
      );
    });
  });

  describe("Event Template Substitution", () => {
    it("should substitute event templates in command when enabled", async () => {
      const config = createConfig([
        createPipelineItem({ name: "producer" }),
        createPipelineItem({
          name: "consumer",
          command: "node app.js --source={{event.source}} --event={{event.name}}",
          trigger_on: ["producer:done"],
          enable_event_templates: true,
        }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "producer:done",
        processName: "producer",
        type: "custom",
        timestamp: 1706012345678,
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "consumer",
          command: "node app.js --source=producer --event=producer:done",
        }),
      );
    });

    it("should substitute event templates in env vars when enabled", async () => {
      const config = createConfig([
        createPipelineItem({ name: "producer" }),
        createPipelineItem({
          name: "consumer",
          command: "node app.js",
          trigger_on: ["producer:done"],
          enable_event_templates: true,
          env: {
            TRIGGER_SOURCE: "{{event.source}}",
            TRIGGER_EVENT: "{{event.name}}",
            TRIGGER_TYPE: "{{event.type}}",
          },
        }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "producer:done",
        processName: "producer",
        type: "success",
        timestamp: 1706012345678,
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "consumer",
          env: expect.objectContaining({
            TRIGGER_SOURCE: "producer",
            TRIGGER_EVENT: "producer:done",
            TRIGGER_TYPE: "success",
          }),
        }),
      );
    });

    it("should substitute process and clier templates", async () => {
      const config = createConfig([
        createPipelineItem({ name: "producer" }),
        createPipelineItem({
          name: "consumer",
          command: "node app.js --proc={{process.name}} --project={{clier.project}}",
          type: "task",
          trigger_on: ["producer:done"],
          enable_event_templates: true,
        }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "producer:done",
        processName: "producer",
        type: "custom",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "node app.js --proc=consumer --project=test-project",
        }),
      );
    });

    it("should NOT substitute templates when enable_event_templates is false", async () => {
      const config = createConfig([
        createPipelineItem({ name: "producer" }),
        createPipelineItem({
          name: "consumer",
          command: "node app.js --source={{event.source}}",
          trigger_on: ["producer:done"],
          enable_event_templates: false, // Disabled
        }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "producer:done",
        processName: "producer",
        type: "custom",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(event);

      // Should NOT substitute - template remains as-is
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "node app.js --source={{event.source}}",
        }),
      );
    });

    it("should NOT substitute templates for entry point processes", async () => {
      const config = createConfig([
        createPipelineItem({
          name: "entry",
          command: "node app.js --source={{event.source}}",
          enable_event_templates: true,
        }),
      ]);

      orchestrator.loadPipeline(config);
      await orchestrator.start();

      // Entry point has no trigger event, so templates should NOT be substituted
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "node app.js --source={{event.source}}",
        }),
      );
    });

    it("should handle templates with mixed variables", async () => {
      const config = createConfig([
        createPipelineItem({ name: "producer" }),
        createPipelineItem({
          name: "logger",
          command:
            "node log.js --event={{event.name}} --from={{event.source}} --to={{process.name}} --ts={{event.timestamp}}",
          trigger_on: ["producer:done"],
          enable_event_templates: true,
        }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "producer:done",
        processName: "producer",
        type: "custom",
        timestamp: 1706012345678,
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command:
            "node log.js --event=producer:done --from=producer --to=logger --ts=1706012345678",
        }),
      );
    });

    it("should preserve global_env when using templates", async () => {
      process.env["GLOBAL_VAR"] = "global-value";

      const config = createConfig([
        createPipelineItem({ name: "producer" }),
        createPipelineItem({
          name: "consumer",
          command: "node app.js",
          trigger_on: ["producer:done"],
          enable_event_templates: true,
          env: {
            TRIGGER_SOURCE: "{{event.source}}",
            LOCAL_VAR: "local-value",
          },
        }),
      ]);

      orchestrator.loadPipeline(config);

      const event: ClierEvent = {
        name: "producer:done",
        processName: "producer",
        type: "custom",
        timestamp: Date.now(),
      };

      await orchestrator.handleEvent(event);

      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            TRIGGER_SOURCE: "producer",
            LOCAL_VAR: "local-value",
            GLOBAL_VAR: "global-value",
          }),
        }),
      );

      delete process.env["GLOBAL_VAR"];
    });
  });
});
