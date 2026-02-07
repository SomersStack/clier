/**
 * Unit tests for version-checker utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.hoisted ensures the mock is available when vi.mock factories are hoisted
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

// Mock child_process.exec before importing the module under test
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock util.promisify so that promisify(exec) returns a mock we control
vi.mock("util", () => ({
  promisify: vi.fn(() => mockExecAsync),
}));

// Mock fs functions
vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock os.homedir
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock path module to keep join and dirname working normally,
// but we need fileURLToPath and dirname to produce predictable results
// for packageJsonPath resolution. We mock url instead.
vi.mock("url", () => ({
  fileURLToPath: vi.fn(() => "/mock/src/cli/utils/version-checker.ts"),
}));

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import {
  checkForUpdates,
  shouldShowUpdatePrompt,
} from "../../../src/cli/utils/version-checker.js";

describe("Version Checker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("checkForUpdates", () => {
    it("should return hasUpdate=true when latest is newer", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ version: "0.2.0" }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "0.3.0\n" });

      const result = await checkForUpdates();

      expect(result).toEqual({
        currentVersion: "0.2.0",
        latestVersion: "0.3.0",
        hasUpdate: true,
      });
      expect(mockExecAsync).toHaveBeenCalledWith("npm view clier-ai version");
    });

    it("should return hasUpdate=false when versions are equal", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ version: "1.0.0" }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "1.0.0\n" });

      const result = await checkForUpdates();

      expect(result).toEqual({
        currentVersion: "1.0.0",
        latestVersion: "1.0.0",
        hasUpdate: false,
      });
    });

    it("should return hasUpdate=false when current is newer", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ version: "2.0.0" }),
      );
      mockExecAsync.mockResolvedValue({ stdout: "1.5.0\n" });

      const result = await checkForUpdates();

      expect(result).toEqual({
        currentVersion: "2.0.0",
        latestVersion: "1.5.0",
        hasUpdate: false,
      });
    });

    it("should handle npm 404 (package not on npm yet) by returning current version as latest", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ version: "0.1.0" }),
      );
      const npmError = new Error("npm ERR! code E404") as Error & {
        stderr?: string;
      };
      npmError.stderr =
        "npm ERR! 404 Not Found - GET https://registry.npmjs.org/clier-ai";
      mockExecAsync.mockRejectedValue(npmError);

      const result = await checkForUpdates();

      expect(result).toEqual({
        currentVersion: "0.1.0",
        latestVersion: "0.1.0",
        hasUpdate: false,
      });
    });

    it("should throw on npm network error", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ version: "0.1.0" }),
      );
      const networkError = new Error("network timeout") as Error & {
        stderr?: string;
      };
      networkError.stderr = "npm ERR! network timeout";
      mockExecAsync.mockRejectedValue(networkError);

      await expect(checkForUpdates()).rejects.toThrow(
        "Failed to fetch latest version",
      );
    });
  });

  describe("shouldShowUpdatePrompt", () => {
    it("should return true when no cache file exists", () => {
      // Cache dir exists, but cache file does not
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (String(path).endsWith(".clier")) return true;
        if (String(path).endsWith("last-update-check")) return false;
        return false;
      });

      const result = shouldShowUpdatePrompt();

      expect(result).toBe(true);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("last-update-check"),
        expect.any(String),
        "utf-8",
      );
    });

    it("should return false when cache is less than 24 hours old", () => {
      const recentTimestamp = (Date.now() - 1000 * 60 * 60).toString(); // 1 hour ago

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(recentTimestamp);

      const result = shouldShowUpdatePrompt();

      expect(result).toBe(false);
      // writeFileSync should NOT be called because we return false early
      expect(writeFileSync).not.toHaveBeenCalled();
    });

    it("should return true when cache is more than 24 hours old", () => {
      const oldTimestamp = (Date.now() - 1000 * 60 * 60 * 25).toString(); // 25 hours ago

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(oldTimestamp);

      const result = shouldShowUpdatePrompt();

      expect(result).toBe(true);
      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("last-update-check"),
        expect.any(String),
        "utf-8",
      );
    });

    it("should create cache directory if it does not exist", () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (String(path).endsWith(".clier")) return false; // dir doesn't exist
        if (String(path).endsWith("last-update-check")) return false;
        return false;
      });

      shouldShowUpdatePrompt();

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".clier"),
        { recursive: true },
      );
    });

    it("should return false on any filesystem error", () => {
      vi.mocked(existsSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = shouldShowUpdatePrompt();

      expect(result).toBe(false);
    });
  });
});
