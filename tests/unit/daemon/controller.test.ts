/**
 * Unit tests for daemon controller RPC methods
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DaemonController } from "../../../src/daemon/controller.js";
import { Watcher } from "../../../src/watcher.js";
import { ProcessManager } from "../../../src/core/process-manager.js";
import type { ProcessConfig } from "../../../src/core/managed-process.js";

// Mock the Watcher
vi.mock("../../../src/watcher.js", () => ({
  Watcher: vi.fn(),
}));

describe("DaemonController", () => {
  let controller: DaemonController;
  let mockWatcher: any;
  let mockProcessManager: any;

  beforeEach(() => {
    // Create mock ProcessManager
    mockProcessManager = {
      startProcess: vi.fn(),
      stopProcess: vi.fn(),
      restartProcess: vi.fn(),
      deleteProcess: vi.fn(),
      listProcesses: vi.fn(),
    };

    // Create mock Watcher
    mockWatcher = {
      getProcessManager: vi.fn().mockReturnValue(mockProcessManager),
      getLogManager: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    controller = new DaemonController(mockWatcher);
  });

  describe("ping", () => {
    it("should return pong", async () => {
      const result = await controller.ping();
      expect(result).toEqual({ pong: true });
    });
  });

  describe("process.list", () => {
    it("should list all processes", async () => {
      const mockProcesses = [
        {
          name: "backend",
          pid: 1234,
          status: "running",
          uptime: 1000,
          restarts: 0,
        },
        {
          name: "frontend",
          pid: 5678,
          status: "running",
          uptime: 2000,
          restarts: 1,
        },
      ];

      mockProcessManager.listProcesses.mockReturnValue(mockProcesses);

      const result = await controller["process.list"]();

      expect(result).toEqual(mockProcesses);
      expect(mockProcessManager.listProcesses).toHaveBeenCalled();
    });

    it("should throw error if ProcessManager not initialized", async () => {
      mockWatcher.getProcessManager.mockReturnValue(null);

      await expect(controller["process.list"]()).rejects.toThrow(
        "ProcessManager not initialized"
      );
    });
  });

  describe("process.stop", () => {
    it("should stop a specific process", async () => {
      mockProcessManager.stopProcess.mockResolvedValue(undefined);

      const result = await controller["process.stop"]({ name: "backend" });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.stopProcess).toHaveBeenCalledWith("backend", false);
    });

    it("should throw error if ProcessManager not initialized", async () => {
      mockWatcher.getProcessManager.mockReturnValue(null);

      await expect(
        controller["process.stop"]({ name: "backend" })
      ).rejects.toThrow("ProcessManager not initialized");
    });

    it("should propagate errors from ProcessManager", async () => {
      mockProcessManager.stopProcess.mockRejectedValue(
        new Error('Process "backend" not found')
      );

      await expect(
        controller["process.stop"]({ name: "backend" })
      ).rejects.toThrow('Process "backend" not found');
    });
  });

  describe("process.restart", () => {
    it("should restart a specific process", async () => {
      mockProcessManager.restartProcess.mockResolvedValue(undefined);

      const result = await controller["process.restart"]({ name: "backend" });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.restartProcess).toHaveBeenCalledWith("backend", false);
    });

    it("should throw error if ProcessManager not initialized", async () => {
      mockWatcher.getProcessManager.mockReturnValue(null);

      await expect(
        controller["process.restart"]({ name: "backend" })
      ).rejects.toThrow("ProcessManager not initialized");
    });

    it("should propagate errors from ProcessManager", async () => {
      mockProcessManager.restartProcess.mockRejectedValue(
        new Error('Process "backend" not found')
      );

      await expect(
        controller["process.restart"]({ name: "backend" })
      ).rejects.toThrow('Process "backend" not found');
    });
  });

  describe("process.add", () => {
    it("should add a new process with minimal config", async () => {
      const config: ProcessConfig = {
        name: "new-service",
        command: "npm start",
        type: "service",
      };

      mockProcessManager.startProcess.mockResolvedValue(undefined);

      const result = await controller["process.add"]({ config });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(config);
    });

    it("should add a new process with full config", async () => {
      const config: ProcessConfig = {
        name: "new-service",
        command: "node server.js",
        type: "service",
        cwd: "/app/backend",
        env: { PORT: "3000", NODE_ENV: "production" },
        restart: { enabled: true, maxRetries: 5 },
      };

      mockProcessManager.startProcess.mockResolvedValue(undefined);

      const result = await controller["process.add"]({ config });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(config);
    });

    it("should add a task type process", async () => {
      const config: ProcessConfig = {
        name: "build-task",
        command: "npm run build",
        type: "task",
      };

      mockProcessManager.startProcess.mockResolvedValue(undefined);

      const result = await controller["process.add"]({ config });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(config);
    });

    it("should throw error if ProcessManager not initialized", async () => {
      mockWatcher.getProcessManager.mockReturnValue(null);

      await expect(
        controller["process.add"]({
          config: { name: "test", command: "echo", type: "task" },
        })
      ).rejects.toThrow("ProcessManager not initialized");
    });

    it("should propagate errors from ProcessManager", async () => {
      mockProcessManager.startProcess.mockRejectedValue(
        new Error('Process "new-service" is already running')
      );

      await expect(
        controller["process.add"]({
          config: { name: "new-service", command: "npm start", type: "service" },
        })
      ).rejects.toThrow('Process "new-service" is already running');
    });
  });

  describe("process.delete", () => {
    it("should delete a process", async () => {
      mockProcessManager.deleteProcess.mockResolvedValue(undefined);

      const result = await controller["process.delete"]({ name: "backend" });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.deleteProcess).toHaveBeenCalledWith("backend");
    });

    it("should throw error if ProcessManager not initialized", async () => {
      mockWatcher.getProcessManager.mockReturnValue(null);

      await expect(
        controller["process.delete"]({ name: "backend" })
      ).rejects.toThrow("ProcessManager not initialized");
    });

    it("should handle non-existent process gracefully", async () => {
      // deleteProcess should be a no-op if process doesn't exist
      mockProcessManager.deleteProcess.mockResolvedValue(undefined);

      const result = await controller["process.delete"]({
        name: "non-existent",
      });

      expect(result).toEqual({ success: true });
      expect(mockProcessManager.deleteProcess).toHaveBeenCalledWith(
        "non-existent"
      );
    });
  });

  describe("logs.query", () => {
    it("should query logs with line limit", async () => {
      const mockLogs = [
        {
          timestamp: Date.now(),
          stream: "stdout",
          data: "Log line 1",
        },
        {
          timestamp: Date.now(),
          stream: "stdout",
          data: "Log line 2",
        },
      ];

      const mockLogManager = {
        getLastN: vi.fn().mockReturnValue(mockLogs),
        getSince: vi.fn(),
      };

      mockWatcher.getLogManager.mockReturnValue(mockLogManager);

      const result = await controller["logs.query"]({
        name: "backend",
        lines: 50,
      });

      expect(result).toEqual(mockLogs);
      expect(mockLogManager.getLastN).toHaveBeenCalledWith("backend", 50);
      expect(mockLogManager.getSince).not.toHaveBeenCalled();
    });

    it("should query logs since timestamp", async () => {
      const mockLogs = [
        {
          timestamp: Date.now(),
          stream: "stdout",
          data: "Recent log",
        },
      ];

      const mockLogManager = {
        getLastN: vi.fn(),
        getSince: vi.fn().mockReturnValue(mockLogs),
      };

      mockWatcher.getLogManager.mockReturnValue(mockLogManager);

      const sinceTimestamp = Date.now() - 60000;

      const result = await controller["logs.query"]({
        name: "backend",
        since: sinceTimestamp,
      });

      expect(result).toEqual(mockLogs);
      expect(mockLogManager.getSince).toHaveBeenCalledWith(
        "backend",
        sinceTimestamp
      );
      expect(mockLogManager.getLastN).not.toHaveBeenCalled();
    });

    it("should default to 100 lines if not specified", async () => {
      const mockLogManager = {
        getLastN: vi.fn().mockReturnValue([]),
        getSince: vi.fn(),
      };

      mockWatcher.getLogManager.mockReturnValue(mockLogManager);

      await controller["logs.query"]({ name: "backend" });

      expect(mockLogManager.getLastN).toHaveBeenCalledWith("backend", 100);
    });

    it("should throw error if LogManager not initialized", async () => {
      mockWatcher.getLogManager.mockReturnValue(null);

      await expect(
        controller["logs.query"]({ name: "backend" })
      ).rejects.toThrow("LogManager not initialized");
    });
  });

  describe("daemon.status", () => {
    it("should return daemon status", async () => {
      const mockProcesses = [
        { name: "backend", status: "running" },
        { name: "frontend", status: "running" },
      ];

      mockProcessManager.listProcesses.mockReturnValue(mockProcesses);
      process.env.CLIER_CONFIG_PATH = "/app/clier-pipeline.json";

      const result = await controller["daemon.status"]();

      expect(result).toMatchObject({
        processCount: 2,
        configPath: "/app/clier-pipeline.json",
        pid: process.pid,
      });
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should handle empty process list", async () => {
      mockProcessManager.listProcesses.mockReturnValue([]);

      const result = await controller["daemon.status"]();

      expect(result.processCount).toBe(0);
    });
  });

  describe("logs.clear", () => {
    it("should clear logs for a specific process", async () => {
      const mockLogManager = {
        deleteLogFiles: vi.fn(),
        deleteAllLogFiles: vi.fn(),
        getProcessNames: vi.fn(),
      };

      mockWatcher.getLogManager.mockReturnValue(mockLogManager);

      const result = await controller["logs.clear"]({ name: "backend" });

      expect(result).toEqual({ success: true, cleared: ["backend"] });
      expect(mockLogManager.deleteLogFiles).toHaveBeenCalledWith("backend");
      expect(mockLogManager.deleteAllLogFiles).not.toHaveBeenCalled();
    });

    it("should clear all process logs when no name specified", async () => {
      const mockLogManager = {
        deleteLogFiles: vi.fn(),
        deleteAllLogFiles: vi.fn(),
        getProcessNames: vi.fn().mockReturnValue(["backend", "frontend"]),
      };

      mockWatcher.getLogManager.mockReturnValue(mockLogManager);

      const result = await controller["logs.clear"]({});

      expect(result).toEqual({
        success: true,
        cleared: ["backend", "frontend"],
      });
      expect(mockLogManager.deleteAllLogFiles).toHaveBeenCalled();
      expect(mockLogManager.deleteLogFiles).not.toHaveBeenCalled();
    });

    it("should throw error if LogManager not initialized", async () => {
      mockWatcher.getLogManager.mockReturnValue(null);

      await expect(controller["logs.clear"]({ name: "backend" })).rejects.toThrow(
        "LogManager not initialized"
      );
    });
  });
});
