import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Watcher } from "../../src/watcher.js";
import fs from "fs/promises";
import path from "path";

describe("E2E: Negative Paths", () => {
  let watcher: Watcher;
  let configPath: string;

  beforeEach(async () => {
    configPath = path.join("/tmp", `clier-test-neg-${Date.now()}.json`);
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

  describe("Process spawn failure", () => {
    it("should handle nonexistent command gracefully", async () => {
      const config = {
        project_name: "e2e-spawn-failure",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "bad-command",
            command: "this-command-does-not-exist-xyz123",
            type: "task",
            events: {
              on_stdout: [],
              on_stderr: true,
              on_crash: true,
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      // Wait for the process to attempt to start and fail
      await new Promise((resolve) => setTimeout(resolve, 500));

      // The process should not be running
      expect(watcher.getProcessManager()?.isRunning("bad-command")).toBe(false);
    }, 3000);

    it("should not block other pipeline steps when a command fails to spawn", async () => {
      const config = {
        project_name: "e2e-spawn-independent",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "broken",
            command: "nonexistent-binary-abc456",
            type: "task",
            events: {
              on_stdout: [],
              on_crash: true,
            },
          },
          {
            name: "healthy",
            command: `node -e "console.log('HEALTHY_OK'); process.exit(0);"`,
            type: "task",
            events: {
              on_stdout: [{ pattern: "HEALTHY_OK", emit: "healthy:done" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Healthy task should still have run
      const history = watcher.getEventHandler()?.getEventHistory() ?? [];
      const healthyEvents = history.filter(
        (e) => e.processName === "healthy" && e.type === "stdout",
      );
      expect(healthyEvents.length).toBeGreaterThan(0);
      expect(healthyEvents.some((e) => String(e.data).includes("HEALTHY_OK"))).toBe(true);
    }, 3000);

    it("should continue pipeline when continue_on_failure is true and spawn fails", async () => {
      const config = {
        project_name: "e2e-spawn-continue",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "failing-spawn",
            command: "totally-fake-binary-789",
            type: "task",
            continue_on_failure: true,
            events: {
              on_crash: true,
              on_stdout: [{ pattern: ".*", emit: "spawn:output" }],
            },
          },
          {
            name: "recovery",
            command: `node -e "console.log('RECOVERED'); process.exit(0);"`,
            type: "task",
            trigger_on: ["process:exit:failing-spawn"],
            events: {
              on_stdout: [{ pattern: "RECOVERED", emit: "recovery:done" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // The failing-spawn process should not be running
      expect(watcher.getProcessManager()?.isRunning("failing-spawn")).toBe(false);
    }, 3000);
  });

  describe("Config corruption at runtime", () => {
    it("should handle deleted config file during reload attempt", async () => {
      const config = {
        project_name: "e2e-config-delete",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "long-running",
            command: `node -e "setInterval(() => console.log('alive'), 100);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "alive", emit: "service:alive" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify service is running
      expect(watcher.getProcessManager()?.isRunning("long-running")).toBe(true);

      // Delete the config file
      await fs.unlink(configPath);

      // Attempting to reload with a missing config should fail
      const newWatcher = new Watcher();
      await expect(
        newWatcher.start(configPath, undefined, { detached: false }),
      ).rejects.toThrow();
    }, 5000);

    it("should handle corrupted config file during reload attempt", async () => {
      const config = {
        project_name: "e2e-config-corrupt",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "worker",
            command: `node -e "setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "worker:output" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Corrupt the config file
      await fs.writeFile(configPath, "{ this is not valid JSON }}}}");

      // A new watcher should fail to start with the corrupted config
      const newWatcher = new Watcher();
      await expect(
        newWatcher.start(configPath, undefined, { detached: false }),
      ).rejects.toThrow();
    }, 5000);

    it("should handle invalid schema in config during reload attempt", async () => {
      const config = {
        project_name: "e2e-config-schema",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "worker",
            command: `node -e "setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "worker:output" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Write valid JSON but invalid schema (missing required fields)
      await fs.writeFile(
        configPath,
        JSON.stringify({ project_name: "broken", pipeline: [] }),
      );

      // A new watcher should fail schema validation
      const newWatcher = new Watcher();
      await expect(
        newWatcher.start(configPath, undefined, { detached: false }),
      ).rejects.toThrow();
    }, 5000);
  });

  describe("Cascading failures and circuit breaker", () => {
    it("should stop restarting service after max retries exceeded", async () => {
      const config = {
        project_name: "e2e-max-retries",
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
            name: "crash-loop",
            command: `node -e "process.exit(1);"`,
            type: "service",
            events: {
              on_stdout: [],
              on_crash: true,
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      // Wait for multiple crash/restart cycles
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // After exceeding retries, the process should no longer be running
      expect(watcher.getProcessManager()?.isRunning("crash-loop")).toBe(false);

      // Verify crash events were recorded
      const history = watcher.getEventHandler()?.getEventHistory() ?? [];
      const exitEvents = history.filter(
        (e) => e.processName === "crash-loop" && e.name === "process:exit",
      );
      expect(exitEvents.length).toBeGreaterThan(0);
    }, 5000);

    it("should not affect healthy services when one service crash-loops", async () => {
      const config = {
        project_name: "e2e-isolated-crash",
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
            name: "unstable-service",
            command: `node -e "process.exit(1);"`,
            type: "service",
            events: {
              on_stdout: [],
              on_crash: true,
            },
          },
          {
            name: "stable-service",
            command: `node -e "console.log('STABLE_RUNNING'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "STABLE_RUNNING", emit: "stable:ready" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Unstable service should be stopped after crash-looping
      expect(watcher.getProcessManager()?.isRunning("unstable-service")).toBe(false);

      // Stable service should still be running
      expect(watcher.getProcessManager()?.isRunning("stable-service")).toBe(true);
    }, 5000);
  });

  describe("Process exit codes", () => {
    it("should record non-zero exit code from a task", async () => {
      const config = {
        project_name: "e2e-exit-code",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "exit-42",
            command: `node -e "process.exit(42);"`,
            type: "task",
            events: {
              on_stdout: [],
              on_crash: true,
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Process should not be running
      expect(watcher.getProcessManager()?.isRunning("exit-42")).toBe(false);

      // Should have exit event in history
      const history = watcher.getEventHandler()?.getEventHistory() ?? [];
      const exitEvents = history.filter(
        (e) => e.processName === "exit-42" && e.name === "process:exit",
      );
      expect(exitEvents.length).toBeGreaterThan(0);
    }, 3000);

    it("should emit stderr events when process writes to stderr", async () => {
      const config = {
        project_name: "e2e-stderr",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "stderr-writer",
            command: `node -e "console.error('ERROR_OUTPUT'); process.exit(1);"`,
            type: "task",
            events: {
              on_stdout: [],
              on_stderr: true,
              on_crash: true,
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should have captured stderr output
      const history = watcher.getEventHandler()?.getEventHistory() ?? [];
      const stderrEvents = history.filter(
        (e) => e.processName === "stderr-writer" && e.type === "stderr",
      );
      expect(stderrEvents.length).toBeGreaterThan(0);
      expect(stderrEvents.some((e) => String(e.data).includes("ERROR_OUTPUT"))).toBe(true);
    }, 3000);
  });

  describe("Watcher lifecycle errors", () => {
    it("should reject start with nonexistent config path", async () => {
      watcher = new Watcher();
      await expect(
        watcher.start("/tmp/nonexistent-config-xyz.json", undefined, { detached: false }),
      ).rejects.toThrow();
    }, 3000);

    it("should reject start with invalid JSON config", async () => {
      await fs.writeFile(configPath, "<<<not json>>>");

      watcher = new Watcher();
      await expect(
        watcher.start(configPath, undefined, { detached: false }),
      ).rejects.toThrow();
    }, 3000);

    it("should reject start with empty pipeline config", async () => {
      const config = {
        project_name: "empty",
        pipeline: [],
      };
      await fs.writeFile(configPath, JSON.stringify(config));

      watcher = new Watcher();
      await expect(
        watcher.start(configPath, undefined, { detached: false }),
      ).rejects.toThrow();
    }, 3000);

    it("should be safe to stop a watcher that was never started", async () => {
      watcher = new Watcher();
      // Should not throw
      await watcher.stop();
    });

    it("should be safe to stop a watcher multiple times", async () => {
      const config = {
        project_name: "e2e-double-stop",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 100,
        },
        pipeline: [
          {
            name: "short-task",
            command: `node -e "console.log('done'); process.exit(0);"`,
            type: "task",
            events: {
              on_stdout: [{ pattern: "done", emit: "task:done" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Stop twice — second should be a no-op
      await watcher.stop();
      await watcher.stop();
    }, 3000);
  });

  describe("Rapid process lifecycle", () => {
    it("should handle process that exits immediately", async () => {
      const config = {
        project_name: "e2e-instant-exit",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 50,
        },
        pipeline: [
          {
            name: "instant",
            command: `node -e "process.exit(0);"`,
            type: "task",
            events: {
              on_stdout: [],
              on_crash: true,
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(watcher.getProcessManager()?.isRunning("instant")).toBe(false);
    }, 3000);

    it("should handle process that produces no output before exiting", async () => {
      const config = {
        project_name: "e2e-silent-exit",
        global_env: true,
        safety: {
          max_ops_per_minute: 60,
          debounce_ms: 50,
        },
        pipeline: [
          {
            name: "silent",
            command: `node -e "setTimeout(() => process.exit(0), 50);"`,
            type: "task",
            events: {
              on_stdout: [{ pattern: ".*", emit: "silent:output" }],
            },
          },
        ],
      };

      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      watcher = new Watcher();
      await watcher.start(configPath, undefined, { detached: false });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not be running
      expect(watcher.getProcessManager()?.isRunning("silent")).toBe(false);

      // Should not have emitted any stdout events for this process
      const history = watcher.getEventHandler()?.getEventHistory() ?? [];
      const stdoutEvents = history.filter(
        (e) => e.processName === "silent" && e.type === "stdout",
      );
      expect(stdoutEvents).toHaveLength(0);
    }, 3000);
  });
});
