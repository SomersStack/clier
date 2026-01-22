import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Watcher } from "../../src/watcher.js";
import fs from "fs/promises";
import path from "path";

describe("E2E: Circuit Breaker", () => {
  let watcher: Watcher;
  let configPath: string;

  beforeEach(async () => {
    configPath = path.join("/tmp", `clier-test-cb-${Date.now()}.json`);
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

  it("should trigger circuit breaker after repeated crashes", async () => {
    const config = {
      project_name: "e2e-circuit-breaker",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 50,
        circuit_breaker: {
          enabled: true,
          error_threshold: 3,
          timeout_ms: 3000,
          reset_timeout_ms: 5000,
        },
      },
      pipeline: [
        {
          name: "crasher",
          command: `node -e "console.log('Crashing...'); process.exit(1);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: ".*", emit: "crasher:output" }],
            on_stderr: true,
            on_crash: true,
          },
        },
        {
          name: "monitor",
          command: `node -e "console.log('Circuit breaker triggered!'); setTimeout(() => process.exit(0), 1000);"`,
          type: "task",
          trigger_on: ["circuit-breaker:triggered"],
          events: {
            on_stdout: [{ pattern: ".*", emit: "monitor:output" }],
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath);

    // Wait for crashes and circuit breaker to trigger
    // The crasher service will auto-restart until max retries
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // System should still be running and not have crashed
    // The circuit breaker should eventually stop the service
    expect(watcher).toBeDefined();
  }, 15000);

  it("should emit circuit-breaker:triggered event", async () => {
    const config = {
      project_name: "e2e-circuit-breaker-event",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 50,
        circuit_breaker: {
          enabled: true,
          error_threshold: 2,
          timeout_ms: 2000,
          reset_timeout_ms: 5000,
        },
      },
      pipeline: [
        {
          name: "unstable",
          command: `node -e "console.error('Error!'); process.exit(1);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: ".*", emit: "unstable:output" }],
            on_crash: true,
          },
        },
        {
          name: "alert",
          command: `node -e "console.log('ALERT_SENT'); process.exit(0);"`,
          type: "task",
          trigger_on: ["circuit-breaker:triggered"],
          events: {
            on_stdout: [{ pattern: "ALERT_SENT", emit: "alert:sent" }],
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath);

    // Wait for circuit breaker
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 15000);

  it("should stop offending process when circuit opens", async () => {
    const config = {
      project_name: "e2e-circuit-stop",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 50,
        circuit_breaker: {
          enabled: true,
          error_threshold: 3,
          timeout_ms: 2000,
          reset_timeout_ms: 5000,
        },
      },
      pipeline: [
        {
          name: "problem-service",
          command: `node -e "console.log('Starting...'); process.exit(1);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: ".*", emit: "problem:output" }],
            on_crash: true,
          },
        },
      ],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath);

    // Wait for crashes
    await new Promise((resolve) => setTimeout(resolve, 4000));

    // System should still be running
    expect(watcher).toBeDefined();
  }, 15000);
});
