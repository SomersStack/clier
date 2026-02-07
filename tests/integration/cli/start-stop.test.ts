/**
 * Integration tests for start and stop commands
 *
 * These tests use real filesystem operations, actual config loading,
 * and verify daemon process lifecycle via the Watcher directly
 * (bypassing the detached daemon spawn for test reliability).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Watcher } from "../../../src/watcher.js";
import { loadConfig } from "../../../src/config/loader.js";
import { DaemonServer } from "../../../src/daemon/server.js";
import { DaemonClient } from "../../../src/daemon/client.js";

describe("start/stop integration", () => {
  let tempDir: string;
  let watcher: Watcher;
  let server: DaemonServer;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "clier-integ-start-"));
    await mkdir(path.join(tempDir, ".clier"), { recursive: true });
  });

  afterEach(async () => {
    // Cleanup in reverse order
    try {
      await server?.stop();
    } catch { /* ignore */ }
    try {
      await watcher?.stop();
    } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should load config, start watcher, and expose daemon status via IPC", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const socketPath = path.join(tempDir, ".clier", "daemon.sock");

    const config = {
      project_name: "integ-test-start",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "echo-service",
          command: `node -e "console.log('SERVICE_READY'); setInterval(() => {}, 1000);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: "SERVICE_READY", emit: "service:ready" }],
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Load and validate config (like start command does)
    const loadedConfig = await loadConfig(configPath);
    expect(loadedConfig.project_name).toBe("integ-test-start");

    // Start watcher (non-detached for test)
    watcher = new Watcher();
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });

    // Start IPC server
    server = new DaemonServer(watcher);
    await server.start(socketPath);

    // Connect client and check status
    const client = new DaemonClient({ socketPath, timeout: 5000 });
    await client.connect();

    const pingResult = await client.request("ping");
    expect(pingResult).toEqual({ pong: true });

    const statusResult = await client.request("daemon.status");
    expect(statusResult).toHaveProperty("pid");
    expect(statusResult).toHaveProperty("processCount");
    expect(statusResult.processCount).toBe(1);

    client.disconnect();
  }, 10000);

  it("should list running processes via IPC after start", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const socketPath = path.join(tempDir, ".clier", "daemon.sock");

    const config = {
      project_name: "integ-test-process-list",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "worker-a",
          command: `node -e "console.log('A_READY'); setInterval(() => {}, 1000);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: "A_READY", emit: "a:ready" }],
          },
        },
        {
          name: "worker-b",
          command: `node -e "console.log('B_READY'); setInterval(() => {}, 1000);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: "B_READY", emit: "b:ready" }],
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });

    // Wait for processes to start
    await new Promise((r) => setTimeout(r, 500));

    server = new DaemonServer(watcher);
    await server.start(socketPath);

    const client = new DaemonClient({ socketPath, timeout: 5000 });
    await client.connect();

    const processes = await client.request("process.list");
    expect(processes).toHaveLength(2);

    const names = processes.map((p: any) => p.name).sort();
    expect(names).toEqual(["worker-a", "worker-b"]);

    // Both should be running
    for (const proc of processes) {
      expect(proc.status).toBe("running");
      expect(proc.pid).toBeGreaterThan(0);
    }

    client.disconnect();
  }, 10000);

  it("should stop a specific process via IPC", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const socketPath = path.join(tempDir, ".clier", "daemon.sock");

    const config = {
      project_name: "integ-test-stop-process",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "stoppable",
          command: `node -e "console.log('RUNNING'); setInterval(() => {}, 1000);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: "RUNNING", emit: "stoppable:ready" }],
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });
    await new Promise((r) => setTimeout(r, 500));

    server = new DaemonServer(watcher);
    await server.start(socketPath);

    const client = new DaemonClient({ socketPath, timeout: 5000 });
    await client.connect();

    // Verify running
    expect(watcher.getProcessManager()?.isRunning("stoppable")).toBe(true);

    // Stop via IPC
    const result = await client.request("process.stop", { name: "stoppable" });
    expect(result).toEqual({ success: true });

    // Wait for stop
    await new Promise((r) => setTimeout(r, 200));

    // Verify stopped
    expect(watcher.getProcessManager()?.isRunning("stoppable")).toBe(false);

    client.disconnect();
  }, 10000);

  it("should shutdown daemon gracefully via IPC", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const socketPath = path.join(tempDir, ".clier", "daemon.sock");

    const config = {
      project_name: "integ-test-shutdown",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "long-lived",
          command: `node -e "setInterval(() => {}, 1000);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: ".*", emit: "service:output" }],
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });
    await new Promise((r) => setTimeout(r, 300));

    server = new DaemonServer(watcher);
    await server.start(socketPath);

    // Stop watcher directly (simulating daemon.shutdown flow)
    await watcher.stop();
    await server.stop();

    // Socket file should no longer accept connections
    const client = new DaemonClient({ socketPath, timeout: 1000 });
    await expect(client.connect()).rejects.toThrow();
  }, 10000);

  it("should handle start when daemon is already running", async () => {
    const configPath = path.join(tempDir, "clier-pipeline.json");
    const socketPath = path.join(tempDir, ".clier", "daemon.sock");

    const config = {
      project_name: "integ-test-already-running",
      global_env: true,
      safety: {
        max_ops_per_minute: 60,
        debounce_ms: 100,
      },
      pipeline: [
        {
          name: "service",
          command: `node -e "setInterval(() => {}, 1000);"`,
          type: "service",
          events: {
            on_stdout: [{ pattern: ".*", emit: "service:output" }],
          },
        },
      ],
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));

    watcher = new Watcher();
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });

    // Second start on same watcher is a no-op (already started)
    await watcher.start(configPath, tempDir, { detached: false, setupSignalHandlers: false });

    // Should still be running fine
    expect(watcher.getProcessManager()).toBeDefined();
  }, 10000);
});
