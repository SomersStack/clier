/**
 * Unit tests for the input command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { inputCommand } from "../../../../src/cli/commands/input.js";
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

describe("Input Command", () => {
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

  describe("send input successfully", () => {
    it("should send input to a process with default newline=true", async () => {
      mockClient.request.mockResolvedValue({ bytesWritten: 12 });

      const exitCode = await inputCommand("my-service", "hello world");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.input", {
        name: "my-service",
        data: "hello world",
        appendNewline: true,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("send input with newline=false", () => {
    it("should send input without appending newline", async () => {
      mockClient.request.mockResolvedValue({ bytesWritten: 5 });

      const exitCode = await inputCommand("my-service", "hello", {
        newline: false,
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("process.input", {
        name: "my-service",
        data: "hello",
        appendNewline: false,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("daemon not running", () => {
    it("should return 1 when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running"),
      );

      const exitCode = await inputCommand("my-service", "hello");

      expect(exitCode).toBe(1);
    });
  });

  describe("process not found", () => {
    it("should return 1 when process is not found", async () => {
      mockClient.request.mockRejectedValue(
        new Error('Process "my-service" not found'),
      );

      const exitCode = await inputCommand("my-service", "hello");

      expect(exitCode).toBe(1);
    });
  });
});
