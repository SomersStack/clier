/**
 * Unit tests for the events command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventsCommand } from "../../../../src/cli/commands/events.js";
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

describe("Events Command", () => {
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

  describe("show events successfully", () => {
    it("should display events from daemon", async () => {
      mockClient.request.mockResolvedValue([
        {
          timestamp: Date.now(),
          processName: "my-service",
          type: "success",
          name: "build-complete",
          data: "all good",
        },
        {
          timestamp: Date.now(),
          processName: "my-service",
          type: "error",
          name: "lint-failed",
          data: undefined,
        },
      ]);

      const exitCode = await eventsCommand();

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("events.query", {
        processName: undefined,
        eventType: undefined,
        eventName: undefined,
        lines: undefined,
        since: undefined,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("no events found", () => {
    it("should print warning when no events are found", async () => {
      mockClient.request.mockResolvedValue([]);

      const exitCode = await eventsCommand();

      expect(exitCode).toBe(0);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("invalid duration format", () => {
    it("should return 1 for invalid since duration", async () => {
      const exitCode = await eventsCommand({ since: "invalid" });

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return 1 for unsupported duration unit", async () => {
      const exitCode = await eventsCommand({ since: "5w" });

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("daemon not running", () => {
    it("should return 1 when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running"),
      );

      const exitCode = await eventsCommand();

      expect(exitCode).toBe(1);
    });
  });

  describe("events with filters", () => {
    it("should pass process filter to daemon query", async () => {
      mockClient.request.mockResolvedValue([]);

      const exitCode = await eventsCommand({ process: "my-service" });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("events.query", {
        processName: "my-service",
        eventType: undefined,
        eventName: undefined,
        lines: undefined,
        since: undefined,
      });
    });

    it("should pass type filter to daemon query", async () => {
      mockClient.request.mockResolvedValue([]);

      const exitCode = await eventsCommand({ type: "error" });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("events.query", {
        processName: undefined,
        eventType: "error",
        eventName: undefined,
        lines: undefined,
        since: undefined,
      });
    });

    it("should pass valid since duration as timestamp", async () => {
      mockClient.request.mockResolvedValue([]);

      const before = Date.now();
      const exitCode = await eventsCommand({ since: "5m" });
      const after = Date.now();

      expect(exitCode).toBe(0);
      const call = mockClient.request.mock.calls[0];
      expect(call[0]).toBe("events.query");
      // The since timestamp should be approximately 5 minutes ago
      const sinceTs = call[1].since;
      expect(sinceTs).toBeGreaterThanOrEqual(before - 5 * 60 * 1000);
      expect(sinceTs).toBeLessThanOrEqual(after - 5 * 60 * 1000);
    });
  });
});
