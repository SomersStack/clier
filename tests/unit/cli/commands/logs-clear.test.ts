/**
 * Unit tests for the logs-clear command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logsClearCommand } from "../../../../src/cli/commands/logs-clear.js";
import * as daemonClient from "../../../../src/daemon/client.js";

// Mock the daemon client
vi.mock("../../../../src/daemon/client.js", () => ({
  getDaemonClient: vi.fn(),
}));

// Mock ora
vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
  })),
}));

describe("Logs Clear Command", () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      request: vi.fn(),
      disconnect: vi.fn(),
    };

    vi.mocked(daemonClient.getDaemonClient).mockResolvedValue(mockClient);

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("clear specific process logs", () => {
    it("should clear logs for a specific process", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        cleared: ["my-service"],
      });

      const exitCode = await logsClearCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("logs.clear", {
        name: "my-service",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("clear daemon logs", () => {
    it("should clear daemon logs when daemon option is true", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        cleared: ["combined", "error"],
      });

      const exitCode = await logsClearCommand("", { daemon: true });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("daemon.logs.clear", {
        level: "all",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("clear all logs", () => {
    it("should clear both process and daemon logs when all option is true", async () => {
      // First call: logs.clear for processes
      // Second call: daemon.logs.clear for daemon
      mockClient.request
        .mockResolvedValueOnce({
          success: true,
          cleared: ["service-a", "service-b"],
        })
        .mockResolvedValueOnce({
          success: true,
          cleared: ["combined", "error"],
        });

      const exitCode = await logsClearCommand("", { all: true });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("logs.clear", {
        name: undefined,
      });
      expect(mockClient.request).toHaveBeenCalledWith("daemon.logs.clear", {
        level: "all",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("no processName and no --all", () => {
    it("should return 1 with usage info when no process name and no --all flag", async () => {
      const exitCode = await logsClearCommand("");

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("daemon not running", () => {
    it("should return 1 when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running"),
      );

      const exitCode = await logsClearCommand("my-service");

      expect(exitCode).toBe(1);
    });
  });
});
