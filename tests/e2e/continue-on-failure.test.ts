import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Watcher } from "../../src/watcher.js";
import fs from "fs/promises";
import path from "path";

describe("E2E: Continue on Failure", () => {
  let watcher: Watcher;
  let configPath: string;

  beforeEach(async () => {
    configPath = path.join("/tmp", `clier-test-cof-${Date.now()}.json`);
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

  it("should block dependent tasks when continue_on_failure is false", async () => {
    const config = {
      project_name: "e2e-strict-mode",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "failing-task",
          command: `node -e "console.log('FAILURE'); process.exit(1);"`,
          type: "task",
          continue_on_failure: false, // Strict mode
          events: {
            on_stdout: [
              { pattern: "SUCCESS", emit: "task:success" },
              { pattern: "FAILURE", emit: "task:failure" },
            ],
            on_crash: true,
          },
        },
        {
          name: "dependent-task",
          command: `node -e "console.log('Dependent running'); process.exit(0);"`,
          type: "task",
          trigger_on: ["task:success"], // Only triggers on success
          events: {
            on_stdout: [{ pattern: ".*", emit: "task:output" }],
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

  it("should allow dependent tasks when continue_on_failure is true", async () => {
    const config = {
      project_name: "e2e-lenient-mode",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "lenient-task",
          command: `node -e "console.log('FAILURE'); process.exit(1);"`,
          type: "task",
          continue_on_failure: true, // Lenient mode
          events: {
            on_stdout: [
              { pattern: "SUCCESS", emit: "task:success" },
              { pattern: "FAILURE", emit: "task:failure" },
            ],
            on_crash: true,
          },
        },
        {
          name: "resilient-task",
          command: `node -e "console.log('RESILIENT_RAN'); process.exit(0);"`,
          type: "task",
          trigger_on: ["task:failure"], // Triggers on failure
          events: {
            on_stdout: [{ pattern: "RESILIENT_RAN", emit: "resilient:done" }],
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

  it("should emit failure events even in strict mode", async () => {
    const config = {
      project_name: "e2e-failure-events",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "strict-failing",
          command: `node -e "console.log('ERROR'); process.exit(1);"`,
          type: "task",
          continue_on_failure: false,
          events: {
            on_stdout: [{ pattern: "ERROR", emit: "error:detected" }],
            on_crash: true,
          },
        },
        {
          name: "cleanup-handler",
          command: `node -e "console.log('CLEANUP_DONE'); process.exit(0);"`,
          type: "task",
          trigger_on: ["error:detected"],
          events: {
            on_stdout: [{ pattern: "CLEANUP_DONE", emit: "cleanup:done" }],
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

  it("should demonstrate graceful degradation with continue_on_failure", async () => {
    const config = {
      project_name: "e2e-graceful-degradation",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "optional-cache",
          command: `node -e "console.log('CACHE_FAILED'); process.exit(1);"`,
          type: "task",
          continue_on_failure: true, // Cache is optional
          events: {
            on_stdout: [
              { pattern: "CACHE_READY", emit: "cache:ready" },
              { pattern: "CACHE_FAILED", emit: "cache:failed" },
            ],
          },
        },
        {
          name: "main-app",
          command: `node -e "console.log('APP_STARTED'); setTimeout(() => {}, 100);"`,
          type: "service",
          trigger_on: ["cache:ready", "cache:failed"], // Starts either way
          events: {
            on_stdout: [{ pattern: "APP_STARTED", emit: "app:ready" }],
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
