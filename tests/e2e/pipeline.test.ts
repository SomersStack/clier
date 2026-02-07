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
          command: `node -e "console.log('Step 1 starting...'); setTimeout(() => { console.log('STEP1_SUCCESS'); process.exit(0); }, 50);"`,
          type: "task",
          events: {
            on_stdout: [{ pattern: "STEP1_SUCCESS", emit: "step1:done" }],
            on_stderr: true,
            on_crash: true,
          },
        },
        {
          name: "step2",
          command: `node -e "console.log('Step 2 starting...'); setTimeout(() => { console.log('STEP2_SUCCESS'); process.exit(0); }, 50);"`,
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
          command: `node -e "console.log('Service starting...'); setTimeout(() => { console.log('SERVICE_READY'); setInterval(() => {}, 1000); }, 50);"`,
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
    // Start watcher with detached: false to prevent orphan processes in tests
    watcher = new Watcher();
    await watcher.start(configPath, undefined, { detached: false });

    // Wait for pipeline to execute
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify step1 and step2 ran by checking their stdout events in history
    const history = watcher.getEventHandler()?.getEventHistory() ?? [];
    const step1Events = history.filter(
      (e) => e.processName === "step1" && e.type === "stdout",
    );
    const step2Events = history.filter(
      (e) => e.processName === "step2" && e.type === "stdout",
    );
    expect(step1Events.length).toBeGreaterThan(0);
    expect(step2Events.length).toBeGreaterThan(0);

    // Verify step2 received its success output (proving it ran to completion)
    expect(
      step2Events.some((e) => String(e.data).includes("STEP2_SUCCESS")),
    ).toBe(true);

    // Verify the service started
    const serviceStatus = watcher.getProcessManager()?.getStatus("service");
    expect(serviceStatus).toBeDefined();
    expect(serviceStatus!.status).toBe("running");
  }, 5000);

  it("should emit events in correct order", async () => {
    // Start watcher with detached: false to prevent orphan processes in tests
    watcher = new Watcher();

    await watcher.start(configPath, undefined, { detached: false });

    // Wait for pipeline
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Verify event ordering by checking stdout timestamps
    const history = watcher.getEventHandler()?.getEventHistory() ?? [];

    // Find the first stdout event from each process
    const step1First = history.find(
      (e) => e.processName === "step1" && e.type === "stdout",
    );
    const step2First = history.find(
      (e) => e.processName === "step2" && e.type === "stdout",
    );
    const serviceFirst = history.find(
      (e) => e.processName === "service" && e.type === "stdout",
    );

    expect(step1First).toBeDefined();
    expect(step2First).toBeDefined();
    expect(serviceFirst).toBeDefined();

    // Verify ordering: step1 before step2 before service
    expect(step1First!.timestamp).toBeLessThanOrEqual(step2First!.timestamp);
    expect(step2First!.timestamp).toBeLessThanOrEqual(serviceFirst!.timestamp);
  }, 5000);

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
          command: `node -e "console.log('Independent running'); setTimeout(() => process.exit(0), 50);"`,
          type: "task",
          events: {
            on_stdout: [{ pattern: ".*", emit: "task:output" }],
          },
        },
        {
          name: "dependent",
          command: `node -e "console.log('Dependent running'); setTimeout(() => process.exit(0), 50);"`,
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
      await watcher.start(noTriggerPath, undefined, { detached: false });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify independent process ran (its stdout events appear in history)
      const history = watcher.getEventHandler()?.getEventHistory() ?? [];
      const independentEvents = history.filter(
        (e) => e.processName === "independent",
      );
      expect(independentEvents.length).toBeGreaterThan(0);

      // Verify dependent process did NOT run — no events from it in history
      const dependentEvents = history.filter(
        (e) => e.processName === "dependent",
      );
      expect(dependentEvents).toHaveLength(0);

      // Dependent should not be running
      expect(watcher.getProcessManager()?.isRunning("dependent")).toBe(false);
    } finally {
      await fs.unlink(noTriggerPath).catch(() => {});
    }
  }, 3000);
});
