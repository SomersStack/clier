/**
 * Unit tests for the stop command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stopCommand } from "../../../../src/cli/commands/stop.js";
import * as daemonClient from "../../../../src/daemon/client.js";

// Mock the daemon client
vi.mock("../../../../src/daemon/client.js", () => ({
  getDaemonClient: vi.fn(),
}));

// Mock project-root utilities
vi.mock("../../../../src/utils/project-root.js", () => ({
  findProjectRootForDaemon: vi.fn(() => "/fake/project"),
}));

// Mock fs (used by waitForDaemonExit)
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "12345"),
  };
});

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

describe("Stop Command", () => {
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

  describe("stop entire daemon", () => {
    it("should stop the daemon successfully and return 0", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await stopCommand();

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("daemon.shutdown");
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("stop specific process", () => {
    it("should stop a specific process successfully and return 0", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await stopCommand({ process: "my-service" });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.stop", {
        name: "my-service",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return 1 when stopping a process fails", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" not found')
      );

      const exitCode = await stopCommand({ process: "my-service" });

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("daemon not running", () => {
    it("should return 0 with warning when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running")
      );

      const exitCode = await stopCommand();

      expect(exitCode).toBe(0);
    });
  });
});
