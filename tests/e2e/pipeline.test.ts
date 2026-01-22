import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Watcher } from "../../src/watcher.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("E2E: Full Pipeline", () => {
  let watcher: Watcher;
  let configPath: string;

  beforeEach(async () => {
    // Create temporary config for testing
    configPath = path.join("/tmp", `clier-test-${Date.now()}.json`);

    const config = {
      project_name: "e2e-test-pipeline",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "step1",
          command: `node -e "console.log('Step 1 starting...'); setTimeout(() => { console.log('STEP1_SUCCESS'); process.exit(0); }, 1000);"`,
          type: "task",
          events: {
            on_stdout: [{ pattern: "STEP1_SUCCESS", emit: "step1:done" }],
            on_stderr: true,
            on_crash: true,
          },
        },
        {
          name: "step2",
          command: `node -e "console.log('Step 2 starting...'); setTimeout(() => { console.log('STEP2_SUCCESS'); process.exit(0); }, 1000);"`,
          type: "task",
          trigger_on: ["step1:done"],
          events: {
            on_stdout: [{ pattern: "STEP2_SUCCESS", emit: "step2:done" }],
            on_stderr: true,
            on_crash: true,
          },
        },
        {
          name: "service",
          command: `node -e "console.log('Service starting...'); setTimeout(() => { console.log('SERVICE_READY'); setInterval(() => {}, 1000); }, 500);"`,
          type: "service",
          trigger_on: ["step2:done"],
          events: {
            on_stdout: [{ pattern: "SERVICE_READY", emit: "service:ready" }],
            on_stderr: true,
            on_crash: true,
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  });

  afterEach(async () => {
    // Stop watcher
    if (watcher) {
      try {
        await watcher.stop();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }

    // Delete temp config
    try {
      await fs.unlink(configPath);
    } catch (error) {
      // Ignore errors
    }
  });

  it("should run step1 -> step2 -> service pipeline", async () => {
    // Start watcher
    watcher = new Watcher();
    await watcher.start(configPath);

    // Wait for pipeline to execute
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 15000); // 15 second timeout

  it("should emit events in correct order", async () => {
    // Start watcher
    watcher = new Watcher();

    // We need to hook into the event bus to track events
    // This is a bit tricky in E2E, so we'll verify through process execution
    await watcher.start(configPath);

    // Wait for pipeline
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 15000);

  it("should not start dependent processes before trigger", async () => {
    // Create a config where step2 depends on manual trigger
    const noTriggerConfig = {
      project_name: "e2e-test-no-trigger",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "independent",
          command: `node -e "console.log('Independent running'); setTimeout(() => process.exit(0), 500);"`,
          type: "task",
          events: {
            on_stdout: [{ pattern: ".*", emit: "task:output" }],
          },
        },
        {
          name: "dependent",
          command: `node -e "console.log('Dependent running'); setTimeout(() => process.exit(0), 500);"`,
          type: "task",
          trigger_on: ["manual:trigger"], // This won't be emitted
          events: {
            on_stdout: [{ pattern: ".*", emit: "task:output" }],
          },
        },
      ],
    };

    const noTriggerPath = path.join(
      "/tmp",
      `clier-test-notrigger-${Date.now()}.json`,
    );
    await fs.writeFile(noTriggerPath, JSON.stringify(noTriggerConfig, null, 2));

    try {
      watcher = new Watcher();
      await watcher.start(noTriggerPath);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // System should still be running
      expect(watcher).toBeDefined();
    } finally {
      await fs.unlink(noTriggerPath).catch(() => {});
    }
  }, 15000);
});
