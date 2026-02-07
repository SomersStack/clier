/**
 * Unit tests for Daemon lifecycle management (index.ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Daemon } from "../../../src/daemon/index.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  createContextLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock DaemonServer
vi.mock("../../../src/daemon/server.js", () => ({
  DaemonServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock Watcher
vi.mock("../../../src/watcher.js", () => ({
  Watcher: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock child_process.fork
vi.mock("child_process", () => ({
  fork: vi.fn().mockReturnValue({
    pid: 12345,
    unref: vi.fn(),
  }),
}));

// Mock probeSocket (default: socket is not alive)
vi.mock("../../../src/daemon/utils.js", () => ({
  probeSocket: vi.fn().mockResolvedValue(false),
}));

describe("Daemon", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clier-daemon-test-"));
    configPath = path.join(tmpDir, "clier-pipeline.json");
    fs.writeFileSync(configPath, JSON.stringify({ pipeline: [] }));
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("ensureDaemonDir", () => {
    it("should create .clier directory if it does not exist", async () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      const clierDir = path.join(tmpDir, ".clier");
      expect(fs.existsSync(clierDir)).toBe(false);

      // start() calls ensureDaemonDir, then spawnDetached (fork is mocked)
      await daemon.start();

      expect(fs.existsSync(clierDir)).toBe(true);
    });

    it("should not fail if .clier directory already exists", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await daemon.start();

      expect(fs.existsSync(clierDir)).toBe(true);
    });
  });

  describe("isDaemonRunning", () => {
    it("should return false when no PID file exists", async () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const isRunning = await (daemon as any).isDaemonRunning();
      expect(isRunning).toBe(false);
    });

    it("should return true when PID file exists and process is alive", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      // Write current process PID (which is definitely alive)
      const pidPath = path.join(clierDir, "daemon.pid");
      fs.writeFileSync(pidPath, process.pid.toString());

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      const isRunning = await (daemon as any).isDaemonRunning();
      expect(isRunning).toBe(true);
    });

    it("should return false and clean up stale PID file when process is dead", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      // Write a PID that definitely doesn't exist (very high number)
      const pidPath = path.join(clierDir, "daemon.pid");
      fs.writeFileSync(pidPath, "999999999");

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      const isRunning = await (daemon as any).isDaemonRunning();
      expect(isRunning).toBe(false);

      // Should have cleaned up the stale PID file
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });

  describe("start (detached mode)", () => {
    it("should throw if daemon is already running", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      // Write current process PID to simulate running daemon
      const pidPath = path.join(clierDir, "daemon.pid");
      fs.writeFileSync(pidPath, process.pid.toString());

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await expect(daemon.start()).rejects.toThrow("Daemon already running");
    });

    it("should fork a detached child process with correct env vars", async () => {
      const { fork } = await import("child_process");
      const mockFork = vi.mocked(fork);

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await daemon.start();

      expect(mockFork).toHaveBeenCalledOnce();
      const forkArgs = mockFork.mock.calls[0];

      // Check environment variables
      const options = forkArgs[2] as any;
      expect(options.env.CLIER_DAEMON_MODE).toBe("1");
      expect(options.env.CLIER_CONFIG_PATH).toBe(configPath);
      expect(options.env.CLIER_PROJECT_ROOT).toBe(tmpDir);
      expect(options.detached).toBe(true);
    });

    it("should write PID file after spawning", async () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await daemon.start();

      const pidPath = path.join(tmpDir, ".clier", "daemon.pid");
      expect(fs.existsSync(pidPath)).toBe(true);

      const pidContent = fs.readFileSync(pidPath, "utf-8");
      expect(pidContent).toBe("12345"); // Mock fork returns pid 12345
    });

    it("should unref the child process to allow parent to exit", async () => {
      const { fork } = await import("child_process");
      const mockFork = vi.mocked(fork);
      const mockUnref = vi.fn();
      mockFork.mockReturnValue({ pid: 54321, unref: mockUnref } as any);

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await daemon.start();

      expect(mockUnref).toHaveBeenCalledOnce();
    });
  });

  describe("cleanup", () => {
    it("should remove PID file during cleanup", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const pidPath = path.join(clierDir, "daemon.pid");
      fs.writeFileSync(pidPath, "12345");

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      await (daemon as any).cleanup();

      expect(fs.existsSync(pidPath)).toBe(false);
    });

    it("should remove socket file during cleanup", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const socketPath = path.join(clierDir, "daemon.sock");
      fs.writeFileSync(socketPath, "dummy");

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      await (daemon as any).cleanup();

      expect(fs.existsSync(socketPath)).toBe(false);
    });

    it("should not throw if PID file does not exist during cleanup", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      // Should not throw
      await (daemon as any).cleanup();
    });

    it("should stop server and watcher during cleanup", async () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      // Simulate having a server and watcher
      const mockServer = { stop: vi.fn().mockResolvedValue(undefined) };
      const mockWatcher = { stop: vi.fn().mockResolvedValue(undefined) };
      (daemon as any).server = mockServer;
      (daemon as any).watcher = mockWatcher;

      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      await (daemon as any).cleanup();

      expect(mockServer.stop).toHaveBeenCalledOnce();
      expect(mockWatcher.stop).toHaveBeenCalledOnce();
    });
  });

  describe("getDaemonDir / getSocketPath", () => {
    it("should build correct daemon directory path", () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      const daemonDir = (daemon as any).getDaemonDir();
      expect(daemonDir).toBe(path.join(tmpDir, ".clier"));
    });

    it("should build correct socket path", () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      const socketPath = (daemon as any).getSocketPath();
      expect(socketPath).toBe(path.join(tmpDir, ".clier", "daemon.sock"));
    });
  });

  describe("startDaemonMode", () => {
    it("should throw if CLIER_CONFIG_PATH is missing", async () => {
      const originalConfig = process.env.CLIER_CONFIG_PATH;
      const originalRoot = process.env.CLIER_PROJECT_ROOT;

      delete process.env.CLIER_CONFIG_PATH;
      process.env.CLIER_PROJECT_ROOT = tmpDir;

      const { startDaemonMode } = await import("../../../src/daemon/index.js");

      await expect(startDaemonMode()).rejects.toThrow(
        "Missing CLIER_CONFIG_PATH or CLIER_PROJECT_ROOT",
      );

      // Restore
      if (originalConfig !== undefined)
        process.env.CLIER_CONFIG_PATH = originalConfig;
      if (originalRoot !== undefined)
        process.env.CLIER_PROJECT_ROOT = originalRoot;
      else delete process.env.CLIER_PROJECT_ROOT;
    });

    it("should throw if CLIER_PROJECT_ROOT is missing", async () => {
      const originalConfig = process.env.CLIER_CONFIG_PATH;
      const originalRoot = process.env.CLIER_PROJECT_ROOT;

      process.env.CLIER_CONFIG_PATH = configPath;
      delete process.env.CLIER_PROJECT_ROOT;

      const { startDaemonMode } = await import("../../../src/daemon/index.js");

      await expect(startDaemonMode()).rejects.toThrow(
        "Missing CLIER_CONFIG_PATH or CLIER_PROJECT_ROOT",
      );

      // Restore
      if (originalConfig !== undefined)
        process.env.CLIER_CONFIG_PATH = originalConfig;
      else delete process.env.CLIER_CONFIG_PATH;
      if (originalRoot !== undefined)
        process.env.CLIER_PROJECT_ROOT = originalRoot;
    });
  });

  describe("removePidFile", () => {
    it("should be a no-op if PID file does not exist", () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      // Should not throw
      (daemon as any).removePidFile();
    });

    it("should remove existing PID file", () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const pidPath = path.join(clierDir, "daemon.pid");
      fs.writeFileSync(pidPath, "12345");

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      (daemon as any).removePidFile();
      expect(fs.existsSync(pidPath)).toBe(false);
    });
  });

  describe("removeSocketFile", () => {
    it("should be a no-op if socket file does not exist", () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      // Should not throw
      (daemon as any).removeSocketFile();
    });

    it("should remove existing socket file", () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const socketPath = path.join(clierDir, "daemon.sock");
      fs.writeFileSync(socketPath, "dummy");

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      (daemon as any).removeSocketFile();
      expect(fs.existsSync(socketPath)).toBe(false);
    });
  });

  describe("cleanStaleFiles", () => {
    it("should do nothing when no socket file exists", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      // Should not throw
      await (daemon as any).cleanStaleFiles();
    });

    it("should remove stale socket file when probe returns false", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const socketPath = path.join(clierDir, "daemon.sock");
      fs.writeFileSync(socketPath, "stale");

      const { probeSocket } = await import("../../../src/daemon/utils.js");
      vi.mocked(probeSocket).mockResolvedValue(false);

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await (daemon as any).cleanStaleFiles();
      expect(fs.existsSync(socketPath)).toBe(false);
    });

    it("should throw when socket probe returns true (live daemon without PID)", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const socketPath = path.join(clierDir, "daemon.sock");
      fs.writeFileSync(socketPath, "live");

      const { probeSocket } = await import("../../../src/daemon/utils.js");
      vi.mocked(probeSocket).mockResolvedValue(true);

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: true,
      });

      await expect((daemon as any).cleanStaleFiles()).rejects.toThrow(
        "A daemon appears to be running without a PID file",
      );
    });
  });

  describe("saveState", () => {
    it("should write state file with running process names", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      // Mock watcher with process manager
      const mockPM = {
        listProcesses: vi.fn().mockReturnValue([
          { name: "backend", status: "running" },
          { name: "db", status: "stopped" },
          { name: "worker", status: "running" },
        ]),
      };
      (daemon as any).watcher = { getProcessManager: () => mockPM };

      await (daemon as any).saveState();

      const statePath = path.join(clierDir, "daemon-state.json");
      expect(fs.existsSync(statePath)).toBe(true);

      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      expect(state.pid).toBe(process.pid);
      expect(state.runningProcesses).toEqual(["backend", "worker"]);
      expect(state.savedAt).toBeGreaterThan(0);
    });

    it("should not throw when watcher is not set", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      // Should not throw
      await (daemon as any).saveState();
    });
  });

  describe("startHealthCheck", () => {
    it("should set a health check interval", () => {
      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      (daemon as any).startHealthCheck();

      expect((daemon as any).healthCheckInterval).toBeDefined();

      // Cleanup
      clearInterval((daemon as any).healthCheckInterval);
    });
  });

  describe("cleanup with health check", () => {
    it("should clear health check interval during cleanup", async () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      // Start a health check interval
      (daemon as any).startHealthCheck();
      expect((daemon as any).healthCheckInterval).toBeDefined();

      await (daemon as any).cleanup();

      expect((daemon as any).healthCheckInterval).toBeUndefined();
    });
  });

  describe("removeStateFile", () => {
    it("should remove existing state file", () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });
      const statePath = path.join(clierDir, "daemon-state.json");
      fs.writeFileSync(statePath, "{}");

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      (daemon as any).removeStateFile();
      expect(fs.existsSync(statePath)).toBe(false);
    });

    it("should be a no-op if state file does not exist", () => {
      const clierDir = path.join(tmpDir, ".clier");
      fs.mkdirSync(clierDir, { recursive: true });

      const daemon = new Daemon({
        configPath,
        projectRoot: tmpDir,
        detached: false,
      });

      // Should not throw
      (daemon as any).removeStateFile();
    });
  });
});
