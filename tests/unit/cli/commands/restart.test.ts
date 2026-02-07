/**
 * Unit tests for the restart command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { restartCommand } from "../../../../src/cli/commands/restart.js";

// Mock stop and start commands
vi.mock("../../../../src/cli/commands/stop.js", () => ({
  stopCommand: vi.fn(),
}));

vi.mock("../../../../src/cli/commands/start.js", () => ({
  startCommand: vi.fn(),
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

describe("Restart Command", () => {
  let mockStopCommand: any;
  let mockStartCommand: any;

  beforeEach(async () => {
    const stopModule = await import("../../../../src/cli/commands/stop.js");
    const startModule = await import("../../../../src/cli/commands/start.js");

    mockStopCommand = vi.mocked(stopModule.stopCommand);
    mockStartCommand = vi.mocked(startModule.startCommand);

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("restart successfully", () => {
    it("should stop then start the daemon and return 0", async () => {
      mockStopCommand.mockResolvedValue(0);
      mockStartCommand.mockResolvedValue(0);

      const exitCode = await restartCommand();

      expect(exitCode).toBe(0);
      expect(mockStopCommand).toHaveBeenCalled();
      expect(mockStartCommand).toHaveBeenCalled();
    });

    it("should pass configPath to startCommand", async () => {
      mockStopCommand.mockResolvedValue(0);
      mockStartCommand.mockResolvedValue(0);

      const exitCode = await restartCommand("/path/to/config.json");

      expect(exitCode).toBe(0);
      expect(mockStartCommand).toHaveBeenCalledWith("/path/to/config.json");
    });
  });

  describe("stop fails", () => {
    it("should return error code when stop fails", async () => {
      mockStopCommand.mockResolvedValue(1);

      const exitCode = await restartCommand();

      expect(exitCode).toBe(1);
      expect(mockStopCommand).toHaveBeenCalled();
      expect(mockStartCommand).not.toHaveBeenCalled();
    });
  });

  describe("start fails after stop", () => {
    it("should return error code when start fails", async () => {
      mockStopCommand.mockResolvedValue(0);
      mockStartCommand.mockResolvedValue(1);

      const exitCode = await restartCommand();

      expect(exitCode).toBe(1);
      expect(mockStopCommand).toHaveBeenCalled();
      expect(mockStartCommand).toHaveBeenCalled();
    });
  });
});
