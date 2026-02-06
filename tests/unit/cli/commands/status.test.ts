/**
 * Unit tests for the status command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statusCommand } from "../../../../src/cli/commands/status.js";
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

describe("Status Command", () => {
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

  describe("show status successfully", () => {
    it("should display daemon and process status", async () => {
      // getDaemonClient is called via fetchStatus, which makes 3 sequential requests
      mockClient.request
        .mockResolvedValueOnce({
          pid: 12345,
          uptime: 60000,
          configPath: "/project/clier-pipeline.json",
        })
        .mockResolvedValueOnce([
          {
            name: "web-server",
            type: "service",
            status: "running",
            pid: 12346,
            uptime: 55000,
            restarts: 0,
          },
        ])
        .mockResolvedValueOnce({});

      const exitCode = await statusCommand();

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("daemon.status");
      expect(mockClient.request).toHaveBeenCalledWith("process.list");
      expect(mockClient.request).toHaveBeenCalledWith("stages.map");
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("JSON output mode", () => {
    it("should output JSON format when json option is true", async () => {
      mockClient.request
        .mockResolvedValueOnce({
          pid: 12345,
          uptime: 60000,
          configPath: "/project/clier-pipeline.json",
        })
        .mockResolvedValueOnce([
          {
            name: "web-server",
            type: "service",
            status: "running",
            pid: 12346,
            uptime: 55000,
            restarts: 0,
          },
        ])
        .mockResolvedValueOnce({});

      const exitCode = await statusCommand({ json: true });

      expect(exitCode).toBe(0);
      // console.log should have been called with a JSON string
      const logCalls = vi.mocked(console.log).mock.calls;
      const jsonCall = logCalls.find((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();

      const output = JSON.parse(jsonCall![0]);
      expect(output.daemon.running).toBe(true);
      expect(output.daemon.pid).toBe(12345);
    });
  });

  describe("JSON + watch mutually exclusive", () => {
    it("should return 1 when both json and watch are set", async () => {
      const exitCode = await statusCommand({ json: true, watch: true });

      expect(exitCode).toBe(1);
    });
  });

  describe("daemon not running", () => {
    it("should return 1 with warning in normal mode", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running")
      );

      const exitCode = await statusCommand();

      expect(exitCode).toBe(1);
    });

    it("should return 0 with JSON output when daemon not running in json mode", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running")
      );

      const exitCode = await statusCommand({ json: true });

      expect(exitCode).toBe(0);
      // Should output JSON with daemon.running = false
      const logCalls = vi.mocked(console.log).mock.calls;
      const jsonCall = logCalls.find((call) => {
        try {
          JSON.parse(call[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();

      const output = JSON.parse(jsonCall![0]);
      expect(output.daemon.running).toBe(false);
      expect(output.stages).toEqual([]);
      expect(output.processes).toEqual([]);
    });
  });
});
