import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process.exec before importing the module
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock fs functions used by version-checker
// readFileSync wraps real impl (overridden per-test), others are no-ops
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

// Mock os.homedir to use a fake directory
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/tmp/fake-home-for-version-check"),
  };
});

import { exec } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

describe("Version Checker", () => {
  const mockExec = vi.mocked(exec);
  const mockReadFileSync = vi.mocked(readFileSync);
  const mockWriteFileSync = vi.mocked(writeFileSync);
  const mockExistsSync = vi.mocked(existsSync);
  const mockMkdirSync = vi.mocked(mkdirSync);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Default: readFileSync returns a fake package.json for version reads
    mockReadFileSync.mockImplementation(((path: string) => {
      if (typeof path === "string" && path.includes("package.json")) {
        return JSON.stringify({ version: "1.0.0" });
      }
      if (typeof path === "string" && path.includes("last-update-check")) {
        return "0";
      }
      throw new Error(`Unexpected readFileSync call: ${path}`);
    }) as any);
  });

  describe("checkForUpdates", () => {
    it("should detect when an update is available", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: "2.0.0\n", stderr: "" });
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      const result = await checkForUpdates();

      expect(result.currentVersion).toBe("1.0.0");
      expect(result.latestVersion).toBe("2.0.0");
      expect(result.hasUpdate).toBe(true);
    });

    it("should report no update when versions match", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: "1.0.0\n", stderr: "" });
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      const result = await checkForUpdates();

      expect(result.currentVersion).toBe("1.0.0");
      expect(result.latestVersion).toBe("1.0.0");
      expect(result.hasUpdate).toBe(false);
    });

    it("should report no update when current is newer", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: "0.9.0\n", stderr: "" });
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      const result = await checkForUpdates();

      expect(result.hasUpdate).toBe(false);
    });

    it("should detect minor version update", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: "1.1.0\n", stderr: "" });
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      const result = await checkForUpdates();

      expect(result.hasUpdate).toBe(true);
    });

    it("should detect patch version update", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(null, { stdout: "1.0.1\n", stderr: "" });
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      const result = await checkForUpdates();

      expect(result.hasUpdate).toBe(true);
    });

    it("should fall back to current version on npm 404", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(
          Object.assign(new Error("npm error"), { stderr: "404 Not Found" }),
          { stdout: "", stderr: "404 Not Found" }
        );
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      const result = await checkForUpdates();

      expect(result.hasUpdate).toBe(false);
      expect(result.latestVersion).toBe("1.0.0");
    });

    it("should throw on network failure", async () => {
      mockExec.mockImplementation(((cmd: string, callback: any) => {
        callback(
          Object.assign(new Error("ETIMEDOUT"), { stderr: "ETIMEDOUT" }),
          { stdout: "", stderr: "ETIMEDOUT" }
        );
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      await expect(checkForUpdates()).rejects.toThrow("Failed to fetch latest version");
    });

    it("should throw when package.json is unreadable", async () => {
      mockReadFileSync.mockImplementation((() => {
        throw new Error("ENOENT");
      }) as any);

      const { checkForUpdates } = await import("../../../src/cli/utils/version-checker.js");
      await expect(checkForUpdates()).rejects.toThrow("Failed to read current version");
    });
  });

  describe("shouldShowUpdatePrompt", () => {
    it("should return true when no cache file exists", async () => {
      mockExistsSync.mockImplementation(((path: string) => {
        if (typeof path === "string" && path.includes(".clier")) return true;
        if (typeof path === "string" && path.includes("last-update-check")) return false;
        return false;
      }) as any);

      const { shouldShowUpdatePrompt } = await import("../../../src/cli/utils/version-checker.js");
      expect(shouldShowUpdatePrompt()).toBe(true);
    });

    it("should return false when checked less than a day ago", async () => {
      const recentTimestamp = Date.now().toString();
      mockExistsSync.mockReturnValue(true as any);
      mockReadFileSync.mockImplementation(((path: string) => {
        if (typeof path === "string" && path.includes("last-update-check")) {
          return recentTimestamp;
        }
        return JSON.stringify({ version: "1.0.0" });
      }) as any);

      const { shouldShowUpdatePrompt } = await import("../../../src/cli/utils/version-checker.js");
      expect(shouldShowUpdatePrompt()).toBe(false);
    });

    it("should return true when checked more than a day ago", async () => {
      const oldTimestamp = (Date.now() - 2 * 24 * 60 * 60 * 1000).toString();
      mockExistsSync.mockReturnValue(true as any);
      mockReadFileSync.mockImplementation(((path: string) => {
        if (typeof path === "string" && path.includes("last-update-check")) {
          return oldTimestamp;
        }
        return JSON.stringify({ version: "1.0.0" });
      }) as any);

      const { shouldShowUpdatePrompt } = await import("../../../src/cli/utils/version-checker.js");
      expect(shouldShowUpdatePrompt()).toBe(true);
    });

    it("should create cache directory if it does not exist", async () => {
      mockExistsSync.mockReturnValue(false as any);

      const { shouldShowUpdatePrompt } = await import("../../../src/cli/utils/version-checker.js");
      shouldShowUpdatePrompt();

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(".clier"),
        { recursive: true }
      );
    });

    it("should return false when an error occurs", async () => {
      mockExistsSync.mockImplementation(() => {
        throw new Error("permission denied");
      });

      const { shouldShowUpdatePrompt } = await import("../../../src/cli/utils/version-checker.js");
      expect(shouldShowUpdatePrompt()).toBe(false);
    });

    it("should write current timestamp to cache file", async () => {
      mockExistsSync.mockImplementation(((path: string) => {
        if (typeof path === "string" && path.includes(".clier")) return true;
        return false;
      }) as any);

      const before = Date.now();
      const { shouldShowUpdatePrompt } = await import("../../../src/cli/utils/version-checker.js");
      shouldShowUpdatePrompt();
      const after = Date.now();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("last-update-check"),
        expect.any(String),
        "utf-8"
      );

      const writtenTimestamp = parseInt(
        (mockWriteFileSync.mock.calls[0]?.[1] as string) || "0",
        10
      );
      expect(writtenTimestamp).toBeGreaterThanOrEqual(before);
      expect(writtenTimestamp).toBeLessThanOrEqual(after);
    });
  });
});
