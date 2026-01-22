/**
 * Unit tests for service commands
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  serviceStartCommand,
  serviceStopCommand,
  serviceRestartCommand,
  serviceAddCommand,
  serviceRemoveCommand,
} from "../../../src/cli/commands/service.js";
import * as daemonClient from "../../../src/daemon/client.js";

// Mock the daemon client
vi.mock("../../../src/daemon/client.js", () => ({
  getDaemonClient: vi.fn(),
}));

describe("Service Commands", () => {
  let mockClient: any;

  beforeEach(() => {
    // Create mock client
    mockClient = {
      request: vi.fn(),
      disconnect: vi.fn(),
    };

    // Mock getDaemonClient to return our mock
    vi.mocked(daemonClient.getDaemonClient).mockResolvedValue(mockClient);

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("serviceStartCommand", () => {
    it("should start a service successfully", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceStartCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.start", {
        name: "my-service",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return error when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon not running")
      );

      const exitCode = await serviceStartCommand("my-service");

      expect(exitCode).toBe(1);
    });

    it("should handle service not found error", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" not found')
      );

      const exitCode = await serviceStartCommand("my-service");

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });
  });

  describe("serviceStopCommand", () => {
    it("should stop a service successfully", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceStopCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.stop", {
        name: "my-service",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return error when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon not running")
      );

      const exitCode = await serviceStopCommand("my-service");

      expect(exitCode).toBe(1);
    });

    it("should handle service not found error", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" not found')
      );

      const exitCode = await serviceStopCommand("my-service");

      expect(exitCode).toBe(1);
    });
  });

  describe("serviceRestartCommand", () => {
    it("should restart a service successfully", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceRestartCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.restart", {
        name: "my-service",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return error when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon not running")
      );

      const exitCode = await serviceRestartCommand("my-service");

      expect(exitCode).toBe(1);
    });

    it("should handle service not found error", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" not found')
      );

      const exitCode = await serviceRestartCommand("my-service");

      expect(exitCode).toBe(1);
    });
  });

  describe("serviceAddCommand", () => {
    it("should add a service with minimal config", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceAddCommand("my-service", {
        command: "npm start",
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.add", {
        config: {
          name: "my-service",
          command: "npm start",
          type: "service",
          cwd: undefined,
          env: undefined,
          restart: undefined,
        },
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should add a service with all options", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceAddCommand("my-service", {
        command: "node server.js",
        cwd: "/app/backend",
        type: "service",
        env: ["PORT=3000", "NODE_ENV=production"],
        restart: true,
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.add", {
        config: {
          name: "my-service",
          command: "node server.js",
          type: "service",
          cwd: "/app/backend",
          env: {
            PORT: "3000",
            NODE_ENV: "production",
          },
          restart: { enabled: true },
        },
      });
    });

    it("should add a task type process", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceAddCommand("my-task", {
        command: "npm run build",
        type: "task",
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.add", {
        config: {
          name: "my-task",
          command: "npm run build",
          type: "task",
          cwd: undefined,
          env: undefined,
          restart: undefined,
        },
      });
    });

    it("should handle environment variable with equals sign in value", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceAddCommand("my-service", {
        command: "npm start",
        env: ["DATABASE_URL=postgres://user:pass@localhost/db"],
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.add", {
        config: expect.objectContaining({
          env: {
            DATABASE_URL: "postgres://user:pass@localhost/db",
          },
        }),
      });
    });

    it("should reject invalid environment variable format", async () => {
      const exitCode = await serviceAddCommand("my-service", {
        command: "npm start",
        env: ["INVALID_VAR"],
      });

      expect(exitCode).toBe(1);
      expect(mockClient.request).not.toHaveBeenCalled();
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return error when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon not running")
      );

      const exitCode = await serviceAddCommand("my-service", {
        command: "npm start",
      });

      expect(exitCode).toBe(1);
    });

    it("should handle duplicate service name error", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" is already running')
      );

      const exitCode = await serviceAddCommand("my-service", {
        command: "npm start",
      });

      expect(exitCode).toBe(1);
    });
  });

  describe("serviceRemoveCommand", () => {
    it("should remove a service successfully", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await serviceRemoveCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.delete", {
        name: "my-service",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return error when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon not running")
      );

      const exitCode = await serviceRemoveCommand("my-service");

      expect(exitCode).toBe(1);
    });

    it("should handle service not found error gracefully", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" not found')
      );

      const exitCode = await serviceRemoveCommand("my-service");

      expect(exitCode).toBe(1);
    });
  });
});
