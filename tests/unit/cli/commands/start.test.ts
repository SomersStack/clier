/**
 * Unit tests for the start command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCommand } from "../../../../src/cli/commands/start.js";
import * as daemonClient from "../../../../src/daemon/client.js";
import * as configLoader from "../../../../src/config/loader.js";
import * as projectRoot from "../../../../src/utils/project-root.js";
import { ZodError, ZodIssueCode } from "zod";

// Mock the daemon client
vi.mock("../../../../src/daemon/client.js", () => ({
  getDaemonClient: vi.fn(),
}));

// Mock the config loader
vi.mock("../../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

// Mock the Daemon class
vi.mock("../../../../src/daemon/index.js", () => ({
  Daemon: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock project-root utilities
vi.mock("../../../../src/utils/project-root.js", () => ({
  resolveConfigPath: vi.fn(),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
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

describe("Start Command", () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      request: vi.fn(),
      disconnect: vi.fn(),
    };

    // Default: config resolves, loads, no daemon running
    vi.mocked(projectRoot.resolveConfigPath).mockReturnValue(
      "/fake/project/clier-pipeline.json"
    );
    vi.mocked(configLoader.loadConfig).mockResolvedValue({
      project_name: "test-project",
      pipeline: [],
    } as any);
    // No daemon running by default
    vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
      new Error("Not running")
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful start", () => {
    it("should start the daemon and return 0", async () => {
      // After daemon.start(), getDaemonClient succeeds for waitForDaemon
      let callCount = 0;
      vi.mocked(daemonClient.getDaemonClient).mockImplementation(async () => {
        callCount++;
        // First call is the "is daemon already running?" check - reject
        if (callCount === 1) {
          throw new Error("Not running");
        }
        // Subsequent calls are waitForDaemon - succeed
        return {
          request: vi.fn().mockResolvedValue("pong"),
          disconnect: vi.fn(),
        } as any;
      });

      const exitCode = await startCommand();

      expect(exitCode).toBe(0);
      expect(projectRoot.resolveConfigPath).toHaveBeenCalled();
      expect(configLoader.loadConfig).toHaveBeenCalledWith(
        "/fake/project/clier-pipeline.json"
      );
    });
  });

  describe("config not found", () => {
    it("should return 1 when config path cannot be resolved", async () => {
      vi.mocked(projectRoot.resolveConfigPath).mockImplementation(() => {
        throw new Error("Config file not found");
      });

      const exitCode = await startCommand();

      expect(exitCode).toBe(1);
    });
  });

  describe("config validation error", () => {
    it("should return 1 when config has validation errors (ZodError)", async () => {
      const zodError = new ZodError([
        {
          code: ZodIssueCode.invalid_type,
          expected: "string",
          received: "undefined",
          path: ["project_name"],
          message: "Required",
        },
      ]);
      vi.mocked(configLoader.loadConfig).mockRejectedValue(zodError);

      const exitCode = await startCommand();

      expect(exitCode).toBe(1);
    });
  });

  describe("daemon already running", () => {
    it("should return 1 when daemon is already running", async () => {
      const mockRunningClient = {
        request: vi.fn().mockResolvedValue({
          pid: 12345,
          uptime: 60000,
          processCount: 3,
        }),
        disconnect: vi.fn(),
      };

      vi.mocked(daemonClient.getDaemonClient).mockResolvedValue(
        mockRunningClient as any
      );

      const exitCode = await startCommand();

      expect(exitCode).toBe(1);
      expect(mockRunningClient.request).toHaveBeenCalledWith("daemon.status");
      expect(mockRunningClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("daemon start failure", () => {
    it("should return 1 when daemon fails to start", async () => {
      // Import the mocked Daemon to override start behavior
      const { Daemon } = await import("../../../../src/daemon/index.js");
      vi.mocked(Daemon).mockImplementation(
        () =>
          ({
            start: vi.fn().mockRejectedValue(new Error("Port already in use")),
          }) as any
      );

      const exitCode = await startCommand();

      expect(exitCode).toBe(1);
    });
  });
});
