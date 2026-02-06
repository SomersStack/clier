/**
 * Unit tests for the update command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { updateCommand } from "../../../../src/cli/commands/update.js";
import * as versionChecker from "../../../../src/cli/utils/version-checker.js";

// Mock version checker
vi.mock("../../../../src/cli/utils/version-checker.js", () => ({
  checkForUpdates: vi.fn(),
}));

// Mock child_process (exec is used via promisify)
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock project-root utilities
vi.mock("../../../../src/utils/project-root.js", () => ({
  findProjectRoot: vi.fn(() => null),
}));

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
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

describe("Update Command", () => {
  let mockExec: any;

  beforeEach(async () => {
    const childProcess = await import("child_process");
    mockExec = vi.mocked(childProcess.exec);

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("check mode", () => {
    it("should report no update available and return 0", async () => {
      vi.mocked(versionChecker.checkForUpdates).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdate: false,
      });

      const exitCode = await updateCommand({ check: true });

      expect(exitCode).toBe(0);
    });

    it("should report update available and return 0", async () => {
      vi.mocked(versionChecker.checkForUpdates).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
      });

      const exitCode = await updateCommand({ check: true });

      expect(exitCode).toBe(0);
    });
  });

  describe("already on latest version", () => {
    it("should return 0 when no update is needed", async () => {
      vi.mocked(versionChecker.checkForUpdates).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdate: false,
      });

      const exitCode = await updateCommand({});

      expect(exitCode).toBe(0);
    });
  });

  describe("update succeeds", () => {
    it("should perform update and return 0", async () => {
      vi.mocked(versionChecker.checkForUpdates).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
      });

      // Mock exec to handle detectPackageManager and the actual update
      mockExec.mockImplementation(
        (cmd: string, callback: (err: any, result: any) => void) => {
          if (cmd === "bun --version") {
            // bun detected as package manager
            callback(null, { stdout: "1.0.0", stderr: "" });
          } else if (cmd.includes("bun add")) {
            // Update command succeeds
            callback(null, { stdout: "added clier-ai@2.0.0", stderr: "" });
          } else if (cmd === "clier --version") {
            callback(null, { stdout: "2.0.0", stderr: "" });
          } else {
            callback(new Error("command not found"), null);
          }
        }
      );

      const exitCode = await updateCommand({ global: true });

      expect(exitCode).toBe(0);
    });
  });

  describe("update fails", () => {
    it("should return 1 when update command fails", async () => {
      vi.mocked(versionChecker.checkForUpdates).mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
      });

      // Mock exec: detectPackageManager succeeds, but update fails
      mockExec.mockImplementation(
        (cmd: string, callback: (err: any, result: any) => void) => {
          if (cmd === "bun --version") {
            callback(null, { stdout: "1.0.0", stderr: "" });
          } else if (cmd.includes("bun add")) {
            callback(
              Object.assign(new Error("Permission denied"), {
                stderr: "Permission denied",
                stdout: "",
              }),
              null
            );
          } else {
            callback(new Error("command not found"), null);
          }
        }
      );

      const exitCode = await updateCommand({ global: true });

      expect(exitCode).toBe(1);
    });
  });
});
