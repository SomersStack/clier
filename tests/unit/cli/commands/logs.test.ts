/**
 * Unit tests for the logs command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logsCommand } from "../../../../src/cli/commands/logs.js";
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

describe("Logs Command", () => {
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

  describe("show process logs", () => {
    it("should show process logs successfully", async () => {
      mockClient.request.mockResolvedValue([
        {
          timestamp: Date.now(),
          stream: "stdout",
          data: "Server started on port 3000",
        },
        {
          timestamp: Date.now(),
          stream: "stderr",
          data: "Warning: something happened",
        },
      ]);

      const exitCode = await logsCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("logs.query", {
        name: "my-service",
        lines: undefined,
        since: undefined,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should display warning when no logs are available", async () => {
      mockClient.request.mockResolvedValue([]);

      const exitCode = await logsCommand("my-service");

      expect(exitCode).toBe(0);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("show daemon logs", () => {
    it("should query daemon logs when daemon option is true", async () => {
      mockClient.request.mockResolvedValue([
        '{"timestamp":"2024-01-01T00:00:00.000Z","level":"info","message":"Daemon started"}',
      ]);

      const exitCode = await logsCommand("", { daemon: true });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("daemon.logs", {
        lines: undefined,
        level: "combined",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should show no daemon logs warning when empty", async () => {
      mockClient.request.mockResolvedValue([]);

      const exitCode = await logsCommand("", { daemon: true });

      expect(exitCode).toBe(0);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("invalid duration format", () => {
    it("should return 1 for invalid since duration", async () => {
      const exitCode = await logsCommand("my-service", { since: "invalid" });

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it("should return 1 for unsupported duration unit", async () => {
      const exitCode = await logsCommand("my-service", { since: "5w" });

      expect(exitCode).toBe(1);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("daemon not running", () => {
    it("should return 1 when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running")
      );

      const exitCode = await logsCommand("my-service");

      expect(exitCode).toBe(1);
    });
  });
});
