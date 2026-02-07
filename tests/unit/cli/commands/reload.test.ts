/**
 * Unit tests for the reload command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reloadCommand } from "../../../../src/cli/commands/reload.js";
import * as daemonClient from "../../../../src/daemon/client.js";

// Mock the daemon client
vi.mock("../../../../src/daemon/client.js", () => ({
  getDaemonClient: vi.fn(),
}));

// Mock config loader
vi.mock("../../../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

// Mock project-root utilities
vi.mock("../../../../src/utils/project-root.js", () => ({
  resolveConfigPath: vi.fn(),
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

describe("Reload Command", () => {
  let mockClient: any;
  let mockResolveConfigPath: any;
  let mockLoadConfig: any;

  beforeEach(async () => {
    mockClient = {
      request: vi.fn(),
      disconnect: vi.fn(),
    };

    vi.mocked(daemonClient.getDaemonClient).mockResolvedValue(mockClient);

    const projectRoot = await import("../../../../src/utils/project-root.js");
    mockResolveConfigPath = vi.mocked(projectRoot.resolveConfigPath);
    mockResolveConfigPath.mockReturnValue("/project/clier-pipeline.json");

    const configLoader = await import("../../../../src/config/loader.js");
    mockLoadConfig = vi.mocked(configLoader.loadConfig);
    mockLoadConfig.mockResolvedValue({});

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("reload successfully", () => {
    it("should reload daemon configuration and return 0", async () => {
      mockClient.request.mockResolvedValue({ success: true });

      const exitCode = await reloadCommand();

      expect(exitCode).toBe(0);
      expect(mockResolveConfigPath).toHaveBeenCalled();
      expect(mockLoadConfig).toHaveBeenCalledWith(
        "/project/clier-pipeline.json",
      );
      expect(mockClient.request).toHaveBeenCalledWith("config.reload", {
        configPath: "/project/clier-pipeline.json",
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("reload with restartManualServices", () => {
    it("should use config.clearReload when restartManualServices is true", async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        restartedServices: ["manual-svc"],
      });

      const exitCode = await reloadCommand(undefined, {
        restartManualServices: true,
      });

      expect(exitCode).toBe(0);
      expect(mockClient.request).toHaveBeenCalledWith("config.clearReload", {
        configPath: "/project/clier-pipeline.json",
        restartManualServices: true,
      });
      expect(mockClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("config not found", () => {
    it("should return 1 when config file cannot be found", async () => {
      mockResolveConfigPath.mockImplementation(() => {
        throw new Error("Could not find clier-pipeline.json");
      });

      const exitCode = await reloadCommand();

      expect(exitCode).toBe(1);
    });
  });

  describe("invalid config", () => {
    it("should return 1 when config validation fails", async () => {
      mockLoadConfig.mockRejectedValue(new Error("Invalid configuration"));

      const exitCode = await reloadCommand();

      expect(exitCode).toBe(1);
    });
  });

  describe("daemon not running", () => {
    it("should return 1 when daemon is not running", async () => {
      vi.mocked(daemonClient.getDaemonClient).mockRejectedValue(
        new Error("Daemon is not running"),
      );

      const exitCode = await reloadCommand();

      expect(exitCode).toBe(1);
    });
  });
});
