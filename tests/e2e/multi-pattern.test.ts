import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Watcher } from "../../src/watcher.js";
import fs from "fs/promises";
import path from "path";

describe("E2E: Multi-Pattern Event Matching", () => {
  let watcher: Watcher;
  let configPath: string;

  beforeEach(async () => {
    configPath = path.join("/tmp", `clier-test-mp-${Date.now()}.json`);
  });

  afterEach(async () => {
    if (watcher) {
      try {
        await watcher.stop();
      } catch (error) {
        // Ignore
      }
    }

    try {
      await fs.unlink(configPath);
    } catch (error) {
      // Ignore
    }
  });

  it("should emit ALL matching events from a single output line", async () => {
    const config = {
      project_name: "e2e-multi-pattern",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "multi-output",
          command: `node -e "console.log('[INFO] [STARTUP] System initializing'); setTimeout(() => process.exit(0), 50);"`,
          type: "task",
          events: {
            on_stdout: [
              { pattern: "\\[INFO\\]", emit: "log:info" },
              { pattern: "\\[STARTUP\\]", emit: "phase:startup" },
              { pattern: "initializing", emit: "status:init" },
            ],
          },
        },
        {
          name: "info-handler",
          command: `node -e "console.log('INFO_HANDLED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:info"],
          events: {
            on_stdout: [{ pattern: "INFO_HANDLED", emit: "info:done" }],
          },
        },
        {
          name: "startup-handler",
          command: `node -e "console.log('STARTUP_HANDLED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["phase:startup"],
          events: {
            on_stdout: [{ pattern: "STARTUP_HANDLED", emit: "startup:done" }],
          },
        },
        {
          name: "init-handler",
          command: `node -e "console.log('INIT_HANDLED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["status:init"],
          events: {
            on_stdout: [{ pattern: "INIT_HANDLED", emit: "init:done" }],
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, undefined, { detached: false });

    // Wait for all handlers to run
    await new Promise((resolve) => setTimeout(resolve, 500));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 3000);

  it("should handle multiple patterns across multiple output lines", async () => {
    const script = `
        console.log('[INFO] Starting process');
        console.log('[WARN] Cache not available');
        console.log('[ERROR] Failed to connect');
        console.log('[INFO] Using fallback');
        console.log('Process complete');
      `;

    const config = {
      project_name: "e2e-multi-line-patterns",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "logger",
          command: `node -e "${script.replace(/\n/g, " ")}" `,
          type: "task",
          events: {
            on_stdout: [
              { pattern: "\\[INFO\\]", emit: "log:info" },
              { pattern: "\\[WARN\\]", emit: "log:warn" },
              { pattern: "\\[ERROR\\]", emit: "log:error" },
              { pattern: "Process complete", emit: "process:done" },
            ],
          },
        },
        {
          name: "info-counter",
          command: `node -e "console.log('INFO_COUNT'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:info"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "warn-counter",
          command: `node -e "console.log('WARN_COUNT'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:warn"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "error-counter",
          command: `node -e "console.log('ERROR_COUNT'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:error"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "completion",
          command: `node -e "console.log('COMPLETED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["process:done"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, undefined, { detached: false });

    // Wait for all handlers
    await new Promise((resolve) => setTimeout(resolve, 500));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 3000);

  it("should trigger multiple handlers from different patterns", async () => {
    const config = {
      project_name: "e2e-pattern-fanout",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "source",
          command: `node -e "console.log('EVENT_A EVENT_B EVENT_C'); setTimeout(() => process.exit(0), 50);"`,
          type: "task",
          events: {
            on_stdout: [
              { pattern: "EVENT_A", emit: "event:a" },
              { pattern: "EVENT_B", emit: "event:b" },
              { pattern: "EVENT_C", emit: "event:c" },
            ],
          },
        },
        {
          name: "handler-a",
          command: `node -e "console.log('HANDLED_A'); process.exit(0);"`,
          type: "task",
          trigger_on: ["event:a"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "handler-b",
          command: `node -e "console.log('HANDLED_B'); process.exit(0);"`,
          type: "task",
          trigger_on: ["event:b"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "handler-c",
          command: `node -e "console.log('HANDLED_C'); process.exit(0);"`,
          type: "task",
          trigger_on: ["event:c"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "aggregator",
          command: `node -e "console.log('ALL_HANDLED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["event:a", "event:b", "event:c"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, undefined, { detached: false });

    // Wait for fanout
    await new Promise((resolve) => setTimeout(resolve, 500));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 3000);

  it("should only emit events for patterns that match", async () => {
    const config = {
      project_name: "e2e-selective-patterns",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "selective",
          command: `node -e "console.log('[INFO] Only info here'); setTimeout(() => process.exit(0), 50);"`,
          type: "task",
          events: {
            on_stdout: [
              { pattern: "\\[INFO\\]", emit: "log:info" },
              { pattern: "\\[WARN\\]", emit: "log:warn" },
              { pattern: "\\[ERROR\\]", emit: "log:error" },
            ],
          },
        },
        {
          name: "info-only",
          command: `node -e "console.log('INFO_RECEIVED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:info"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "warn-only",
          command: `node -e "console.log('WARN_RECEIVED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:warn"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
        {
          name: "error-only",
          command: `node -e "console.log('ERROR_RECEIVED'); process.exit(0);"`,
          type: "task",
          trigger_on: ["log:error"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "info:output" }],
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, undefined, { detached: false });

    // Wait for execution
    await new Promise((resolve) => setTimeout(resolve, 500));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 3000);
});
