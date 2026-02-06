/**
 * Unit tests for the emit command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitCommand } from "../../../../src/cli/commands/emit.js";
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

describe("Emit Command", () => {
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

  describe("emit event successfully", () => {
    it("should emit event and show triggered stages", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        triggeredStages: ["build", "deploy"],
      });

      const exitCode = await emitCommand("my-event", {});

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("event.emit", {
        eventName: "my-event",
        data: undefined,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should emit event and warn when no stages are triggered", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        triggeredStages: [],
      });

      const exitCode = await emitCommand("my-event", {});

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("event.emit", {
        eventName: "my-event",
        data: undefined,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("emit event with data", () => {
    it("should parse JSON data correctly", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        triggeredStages: ["stage-1"],
      });

      const exitCode = await emitCommand("my-event", {
        data: '{"key":"value"}',
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("event.emit", {
        eventName: "my-event",
        data: { key: "value" },
      });
    });

    it("should fall back to plain string when data is not valid JSON", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        triggeredStages: ["stage-1"],
      });

      const exitCode = await emitCommand("my-event", {
        data: "plain-string-data",
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("event.emit", {
        eventName: "my-event",
        data: "plain-string-data",
      });
    });
  });

  describe("daemon not running", () => {
    it("should return 1 when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running")
      );

      const exitCode = await emitCommand("my-event", {});

      expect(exitCode).toBe(1);
    });
  });
});
