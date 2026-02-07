/**
 * Integration tests for Event Template Substitution
 *
 * Tests the full flow of event templates:
 * 1. Process emits event
 * 2. Event triggers dependent process
 * 3. Templates are substituted in command and env vars
 * 4. Process executes with resolved values
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { ProcessManager } from "../../src/core/process-manager.js";
import { EventHandler } from "../../src/core/event-handler.js";
import { PatternMatcher } from "../../src/core/pattern-matcher.js";
import type { ClierConfig } from "../../src/config/types.js";
import type { ClierEvent } from "../../src/types/events.js";

/**
 * Helper to wire up ProcessManager -> EventHandler -> Orchestrator
 */
function wireEventHandling(
  processManager: ProcessManager,
  eventHandler: EventHandler,
  orchestrator: Orchestrator,
  config: ClierConfig,
): void {
  // Register pipeline items with event handler for pattern matching
  for (const item of config.pipeline) {
    eventHandler.registerPipelineItem(item);
  }

  // Wire ProcessManager stdout -> EventHandler
  processManager.on(
    "stdout",
    (name: string, data: string, timestamp: number) => {
      eventHandler.handleEvent({
        name: `${name}:stdout`,
        processName: name,
        type: "stdout",
        data,
        timestamp,
      });
    },
  );

  // Wire EventHandler emitted events -> Orchestrator
  // Listen for all events that pipeline items trigger on
  const triggerEvents = new Set<string>();
  for (const item of config.pipeline) {
    if (item.trigger_on) {
      for (const trigger of item.trigger_on) {
        triggerEvents.add(trigger);
      }
    }
  }

  for (const eventName of triggerEvents) {
    eventHandler.on(eventName, (event: ClierEvent) => {
      orchestrator.handleEvent(event);
    });
  }
}

describe("Event Template Integration Tests", () => {
  let orchestrator: Orchestrator;
  let processManager: ProcessManager;
  let eventHandler: EventHandler;
  let patternMatcher: PatternMatcher;

  beforeEach(() => {
    processManager = new ProcessManager();
    orchestrator = new Orchestrator(processManager);
    patternMatcher = new PatternMatcher();
    eventHandler = new EventHandler(patternMatcher);
  });

  afterEach(async () => {
    await processManager.shutdown();
  });

  it("should substitute event templates in triggered process command", async () => {
    const config: ClierConfig = {
      project_name: "template-test",
      global_env: false,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "producer",
          command: "echo 'Producer ready'",
          type: "task",
          enable_event_templates: false,
          events: {
            on_stdout: [
              {
                pattern: "Producer ready",
                emit: "producer:ready",
              },
            ],
            on_stderr: false,
            on_crash: false,
          },
        },
        {
          name: "consumer",
          command:
            "echo 'Triggered by {{event.source}} with event {{event.name}}'",
          type: "task",
          trigger_on: ["producer:ready"],
          enable_event_templates: true,
        },
      ],
    };

    orchestrator.loadPipeline(config);
    wireEventHandling(processManager, eventHandler, orchestrator, config);

    // Track which processes were started
    const startedProcesses: string[] = [];
    let consumerCommand = "";

    // Intercept process starts to verify template substitution
    const originalStartProcess =
      processManager.startProcess.bind(processManager);
    processManager.startProcess = async (processConfig) => {
      startedProcesses.push(processConfig.name);
      if (processConfig.name === "consumer") {
        consumerCommand = processConfig.command;
      }
      return originalStartProcess(processConfig);
    };

    // Start orchestrator (starts entry point "producer")
    await orchestrator.start();

    // Wait for producer to emit event and trigger consumer
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify consumer was started with substituted template
    expect(startedProcesses).toContain("producer");
    expect(startedProcesses).toContain("consumer");
    expect(consumerCommand).toBe(
      "echo 'Triggered by producer with event producer:ready'",
    );
  });

  it("should substitute event templates in environment variables", async () => {
    const config: ClierConfig = {
      project_name: "env-template-test",
      global_env: false,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "backend",
          command: "echo 'Backend ready'",
          type: "service",
          enable_event_templates: false,
          events: {
            on_stdout: [
              {
                pattern: "Backend ready",
                emit: "backend:ready",
              },
            ],
            on_stderr: false,
            on_crash: false,
          },
        },
        {
          name: "frontend",
          command: "echo $TRIGGER_SOURCE $TRIGGER_EVENT",
          type: "task",
          trigger_on: ["backend:ready"],
          enable_event_templates: true,
          env: {
            TRIGGER_SOURCE: "{{event.source}}",
            TRIGGER_EVENT: "{{event.name}}",
            PROCESS_NAME: "{{process.name}}",
            PROJECT: "{{clier.project}}",
          },
        },
      ],
    };

    orchestrator.loadPipeline(config);
    wireEventHandling(processManager, eventHandler, orchestrator, config);

    let frontendEnv: Record<string, string> | undefined;

    // Intercept process starts to verify env template substitution
    const originalStartProcess =
      processManager.startProcess.bind(processManager);
    processManager.startProcess = async (processConfig) => {
      if (processConfig.name === "frontend") {
        frontendEnv = processConfig.env;
      }
      return originalStartProcess(processConfig);
    };

    // Start orchestrator
    await orchestrator.start();

    // Wait for backend to emit event and trigger frontend
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify environment variables were substituted
    expect(frontendEnv).toBeDefined();
    expect(frontendEnv!.TRIGGER_SOURCE).toBe("backend");
    expect(frontendEnv!.TRIGGER_EVENT).toBe("backend:ready");
    expect(frontendEnv!.PROCESS_NAME).toBe("frontend");
    expect(frontendEnv!.PROJECT).toBe("env-template-test");
  });

  it("should NOT substitute templates when enable_event_templates is false", async () => {
    const config: ClierConfig = {
      project_name: "no-template-test",
      global_env: false,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "producer",
          command: "echo 'Ready'",
          type: "task",
          enable_event_templates: false,
          events: {
            on_stdout: [
              {
                pattern: "Ready",
                emit: "producer:ready",
              },
            ],
            on_stderr: false,
            on_crash: false,
          },
        },
        {
          name: "consumer",
          command: "echo 'Source: {{event.source}}'",
          type: "task",
          trigger_on: ["producer:ready"],
          enable_event_templates: false, // Explicitly disabled
        },
      ],
    };

    orchestrator.loadPipeline(config);
    wireEventHandling(processManager, eventHandler, orchestrator, config);

    let consumerCommand = "";

    const originalStartProcess =
      processManager.startProcess.bind(processManager);
    processManager.startProcess = async (processConfig) => {
      if (processConfig.name === "consumer") {
        consumerCommand = processConfig.command;
      }
      return originalStartProcess(processConfig);
    };

    await orchestrator.start();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Templates should NOT be substituted
    expect(consumerCommand).toBe("echo 'Source: {{event.source}}'");
  });

  it("should handle multiple template variables in command", async () => {
    const config: ClierConfig = {
      project_name: "multi-template-test",
      global_env: false,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "api",
          command: "echo 'API ready'",
          type: "service",
          enable_event_templates: false,
          events: {
            on_stdout: [
              {
                pattern: "API ready",
                emit: "api:ready",
              },
            ],
            on_stderr: false,
            on_crash: false,
          },
        },
        {
          name: "logger",
          command:
            "echo 'Event={{event.name}} Source={{event.source}} Process={{process.name}} Type={{process.type}} Project={{clier.project}}'",
          type: "task",
          trigger_on: ["api:ready"],
          enable_event_templates: true,
        },
      ],
    };

    orchestrator.loadPipeline(config);
    wireEventHandling(processManager, eventHandler, orchestrator, config);

    let loggerCommand = "";

    const originalStartProcess =
      processManager.startProcess.bind(processManager);
    processManager.startProcess = async (processConfig) => {
      if (processConfig.name === "logger") {
        loggerCommand = processConfig.command;
      }
      return originalStartProcess(processConfig);
    };

    await orchestrator.start();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // All templates should be substituted
    expect(loggerCommand).toContain("Event=api:ready");
    expect(loggerCommand).toContain("Source=api");
    expect(loggerCommand).toContain("Process=logger");
    expect(loggerCommand).toContain("Type=task");
    expect(loggerCommand).toContain("Project=multi-template-test");
  });

  it("should handle event timestamp templates", async () => {
    const config: ClierConfig = {
      project_name: "timestamp-test",
      global_env: false,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "timer",
          command: "echo 'Tick'",
          type: "task",
          enable_event_templates: false,
          events: {
            on_stdout: [
              {
                pattern: "Tick",
                emit: "timer:tick",
              },
            ],
            on_stderr: false,
            on_crash: false,
          },
        },
        {
          name: "recorder",
          command: "echo 'Timestamp: {{event.timestamp}}'",
          type: "task",
          trigger_on: ["timer:tick"],
          enable_event_templates: true,
        },
      ],
    };

    orchestrator.loadPipeline(config);
    wireEventHandling(processManager, eventHandler, orchestrator, config);

    let recorderCommand = "";

    const originalStartProcess =
      processManager.startProcess.bind(processManager);
    processManager.startProcess = async (processConfig) => {
      if (processConfig.name === "recorder") {
        recorderCommand = processConfig.command;
      }
      return originalStartProcess(processConfig);
    };

    await orchestrator.start();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Timestamp should be substituted with a numeric value
    expect(recorderCommand).toMatch(/Timestamp: \d+/);
  });
});
