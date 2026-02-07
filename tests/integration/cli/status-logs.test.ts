/**
 * Integration tests for status and logs commands
 *
 * These tests use real filesystem operations, actual config loading,
 * real Watcher + DaemonServer + DaemonClient IPC communication.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Watcher } from "../../../src/watcher.js";
import { DaemonServer } from "../../../src/daemon/server.js";
import { DaemonClient } from "../../../src/daemon/client.js";

describe("status/logs integration", () => {
  let tempDir: string;
  let watcher: Watcher;
  let server: DaemonServer;
  let client: DaemonClient;
  let configPath: string;
  let socketPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "clier-integ-status-"));
    await mkdir(path.join(tempDir, ".clier", "logs"), { recursive: true });
    configPath = path.join(tempDir, "clier-pipeline.json");
    socketPath = path.join(tempDir, ".clier", "daemon.sock");
  });

  afterEach(async () => {
    try { client?.disconnect(); } catch { /* ignore */ }
    try { await server?.stop(); } catch { /* ignore */ }
    try { await watcher?.stop(); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to start a full daemon stack (watcher + server + client)
   */
  async function startDaemonStack(config: Record<string, unknown>): Promise<void> {
    await writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });

    server = new DaemonServer(watcher);
    await server.start(socketPath);

    client = new DaemonClient({ socketPath, timeout: 5000 });
    await client.connect();
  }

  describe("status command integration", () => {
    it("should return daemon status with uptime and process count", async () => {
      await startDaemonStack({
        project_name: "integ-status",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "web",
            command: `node -e "console.log('WEB_UP'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "WEB_UP", emit: "web:ready" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 500));

      const status = await client.request("daemon.status");

      expect(status.pid).toBe(process.pid);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.processCount).toBe(1);
    }, 10000);

    it("should return detailed health check", async () => {
      await startDaemonStack({
        project_name: "integ-health",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "api",
            command: `node -e "console.log('API_UP'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "API_UP", emit: "api:ready" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 500));

      const health = await client.request("daemon.health");

      expect(health.healthy).toBe(true);
      expect(health.pid).toBe(process.pid);
      expect(health.memory).toHaveProperty("heapUsedMB");
      expect(health.memory).toHaveProperty("rssMB");
      expect(health.processes.total).toBe(1);
      expect(health.processes.running).toBe(1);
      expect(health.checks.processManager).toBe(true);
      expect(health.checks.eventHandler).toBe(true);
      expect(health.checks.orchestrator).toBe(true);
    }, 10000);

    it("should show correct status for mixed running/stopped processes", async () => {
      await startDaemonStack({
        project_name: "integ-mixed-status",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "long-service",
            command: `node -e "console.log('LS_UP'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "LS_UP", emit: "ls:ready" }],
            },
          },
          {
            name: "quick-task",
            command: `node -e "console.log('TASK_DONE'); process.exit(0);"`,
            type: "task",
            events: {
              on_stdout: [{ pattern: "TASK_DONE", emit: "task:done" }],
            },
          },
        ],
      });

      // Wait for task to complete and service to be running
      await new Promise((r) => setTimeout(r, 500));

      const processes = await client.request("process.list");
      expect(processes.length).toBe(2);

      const service = processes.find((p: any) => p.name === "long-service");
      const task = processes.find((p: any) => p.name === "quick-task");

      expect(service).toBeDefined();
      expect(service.status).toBe("running");
      expect(service.pid).toBeGreaterThan(0);

      expect(task).toBeDefined();
      // Task should have exited (status is "stopped" or "exited")
      expect(task.status).not.toBe("running");
    }, 10000);

    it("should return stage mappings", async () => {
      const stageMap = await client?.request?.("stages.map").catch(() => null);

      // If no stages configured, should be empty object
      // Test with a real stage config:
      await startDaemonStack({
        project_name: "integ-stages",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "backend",
            command: `node -e "console.log('UP'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "UP", emit: "backend:ready" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 300));

      const map = await client.request("stages.map");
      expect(typeof map).toBe("object");
    }, 10000);
  });

  describe("logs command integration", () => {
    it("should return logs for a running process", async () => {
      await startDaemonStack({
        project_name: "integ-logs",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "logger-service",
            command: `node -e "
              console.log('LOG_LINE_1');
              console.log('LOG_LINE_2');
              console.log('LOG_LINE_3');
              setInterval(() => {}, 1000);
            "`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "LOG_LINE", emit: "log:output" }],
            },
          },
        ],
      });

      // Wait for output to be captured
      await new Promise((r) => setTimeout(r, 1000));

      const logs = await client.request("logs.query", {
        name: "logger-service",
        lines: 50,
      });

      expect(logs.length).toBeGreaterThan(0);

      // Verify log entries have expected structure
      for (const entry of logs) {
        expect(entry).toHaveProperty("timestamp");
        expect(entry).toHaveProperty("stream");
        expect(entry).toHaveProperty("data");
      }

      // Check that our specific output lines were captured
      const logData = logs.map((e: any) => e.data);
      expect(logData.some((d: string) => d.includes("LOG_LINE_1"))).toBe(true);
      expect(logData.some((d: string) => d.includes("LOG_LINE_2"))).toBe(true);
      expect(logData.some((d: string) => d.includes("LOG_LINE_3"))).toBe(true);
    }, 10000);

    it("should return empty logs for process with no output", async () => {
      await startDaemonStack({
        project_name: "integ-logs-empty",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "silent-service",
            command: `node -e "setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "silent:output" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 300));

      const logs = await client.request("logs.query", {
        name: "silent-service",
        lines: 50,
      });

      expect(logs).toEqual([]);
    }, 10000);

    it("should throw for nonexistent process name", async () => {
      await startDaemonStack({
        project_name: "integ-logs-notfound",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "real-service",
            command: `node -e "setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "service:output" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 300));

      await expect(
        client.request("logs.query", { name: "nonexistent-process" }),
      ).rejects.toThrow(/not found/);
    }, 10000);

    it("should capture stderr output in logs", async () => {
      await startDaemonStack({
        project_name: "integ-logs-stderr",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "error-producer",
            command: `node -e "
              console.log('STDOUT_MSG');
              console.error('STDERR_MSG');
              setInterval(() => {}, 1000);
            "`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "producer:output" }],
              on_stderr: true,
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 1000));

      const logs = await client.request("logs.query", {
        name: "error-producer",
        lines: 50,
      });

      // Should have both stdout and stderr entries
      const streams = logs.map((e: any) => e.stream);
      expect(streams).toContain("stdout");
      expect(streams).toContain("stderr");

      const logData = logs.map((e: any) => e.data);
      expect(logData.some((d: string) => d.includes("STDOUT_MSG"))).toBe(true);
      expect(logData.some((d: string) => d.includes("STDERR_MSG"))).toBe(true);
    }, 10000);

    it("should respect the lines limit", async () => {
      await startDaemonStack({
        project_name: "integ-logs-limit",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "verbose-service",
            command: `node -e "
              for (let i = 0; i < 20; i++) console.log('LINE_' + i);
              setInterval(() => {}, 1000);
            "`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "LINE_", emit: "verbose:output" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 1000));

      // Request only 5 lines
      const logs = await client.request("logs.query", {
        name: "verbose-service",
        lines: 5,
      });

      expect(logs.length).toBeLessThanOrEqual(5);
    }, 10000);

    it("should clear logs for a specific process", async () => {
      await startDaemonStack({
        project_name: "integ-logs-clear",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "clearable",
            command: `node -e "
              console.log('BEFORE_CLEAR');
              setInterval(() => {}, 1000);
            "`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "clearable:output" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 500));

      // Verify logs exist
      const logs = await client.request("logs.query", {
        name: "clearable",
        lines: 50,
      });
      expect(logs.length).toBeGreaterThan(0);

      // Clear logs
      const clearResult = await client.request("logs.clear", { name: "clearable" });
      expect(clearResult.success).toBe(true);
      expect(clearResult.cleared).toContain("clearable");
    }, 10000);
  });

  describe("event query integration", () => {
    it("should return event history via IPC", async () => {
      await startDaemonStack({
        project_name: "integ-events",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "event-producer",
            command: `node -e "console.log('EVT_MARKER'); process.exit(0);"`,
            type: "task",
            events: {
              on_stdout: [{ pattern: "EVT_MARKER", emit: "marker:found" }],
              on_crash: true,
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 500));

      const events = await client.request("events.query", {
        processName: "event-producer",
        lines: 50,
      });

      expect(events.length).toBeGreaterThan(0);

      // Should have stdout events
      const stdoutEvents = events.filter((e: any) => e.type === "stdout");
      expect(stdoutEvents.length).toBeGreaterThan(0);
    }, 10000);

    it("should filter events by type", async () => {
      await startDaemonStack({
        project_name: "integ-events-filter",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "mixed-output",
            command: `node -e "
              console.log('STDOUT_LINE');
              console.error('STDERR_LINE');
              process.exit(0);
            "`,
            type: "task",
            events: {
              on_stdout: [{ pattern: ".*", emit: "mixed:output" }],
              on_stderr: true,
              on_crash: true,
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 500));

      // Query only stderr events
      const stderrEvents = await client.request("events.query", {
        processName: "mixed-output",
        eventType: "stderr",
      });

      for (const event of stderrEvents) {
        expect(event.type).toBe("stderr");
      }
    }, 10000);
  });

  describe("config reload integration", () => {
    it("should reload config via IPC without losing connection", async () => {
      await startDaemonStack({
        project_name: "integ-reload",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "original-service",
            command: `node -e "console.log('ORIGINAL'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "ORIGINAL", emit: "orig:ready" }],
            },
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 500));

      // Write updated config
      const updatedConfig = {
        project_name: "integ-reload-updated",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "updated-service",
            command: `node -e "console.log('UPDATED'); setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: "UPDATED", emit: "updated:ready" }],
            },
          },
        ],
      };

      await writeFile(configPath, JSON.stringify(updatedConfig, null, 2));

      // Reload via IPC
      const result = await client.request("config.reload", { configPath });
      expect(result).toEqual({ success: true });

      // Wait for reload to take effect
      await new Promise((r) => setTimeout(r, 500));

      // Should now have the updated process
      const processes = await client.request("process.list");
      const names = processes.map((p: any) => p.name);
      expect(names).toContain("updated-service");
    }, 15000);
  });

  describe("client connection handling", () => {
    it("should handle client disconnect and reconnect", async () => {
      await startDaemonStack({
        project_name: "integ-reconnect",
        global_env: true,
        safety: { max_ops_per_minute: 60, debounce_ms: 100 },
        pipeline: [
          {
            name: "persistent",
            command: `node -e "setInterval(() => {}, 1000);"`,
            type: "service",
            events: {
              on_stdout: [{ pattern: ".*", emit: "persistent:output" }],
            },
          },
        ],
      });

      // First connection works
      const result1 = await client.request("ping");
      expect(result1).toEqual({ pong: true });

      // Disconnect
      client.disconnect();

      // Reconnect with new client
      const client2 = new DaemonClient({ socketPath, timeout: 5000 });
      await client2.connect();

      const result2 = await client2.request("ping");
      expect(result2).toEqual({ pong: true });

      client2.disconnect();
    }, 10000);

    it("should timeout when daemon is not running", async () => {
      const deadSocketPath = path.join(tempDir, ".clier", "dead.sock");

      const deadClient = new DaemonClient({
        socketPath: deadSocketPath,
        timeout: 500,
      });

      await expect(deadClient.connect()).rejects.toThrow();
    }, 5000);
  });
});
