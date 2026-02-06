/**
 * Unit tests for the init command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initCommand } from "../../../../src/cli/commands/init.js";

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => "# Template Content\nSome template text"),
  };
});

// Mock fs/promises (dynamically imported in init.ts)
vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock chalk to pass through strings for easier assertion
vi.mock("chalk", () => {
  const handler: ProxyHandler<any> = {
    get(_target, _prop) {
      // Return a function that returns its argument, and is also a proxy
      const fn = (...args: any[]) => args.join("");
      return new Proxy(fn, handler);
    },
    apply(_target, _thisArg, args) {
      return args.join("");
    },
  };
  return { default: new Proxy((...args: any[]) => args.join(""), handler) };
});

describe("Init Command", () => {
  let mockExistsSync: any;
  let mockMkdirSync: any;
  let mockReadFileSync: any;
  let mockWriteFile: any;

  beforeEach(async () => {
    const fs = await import("fs");
    const fsPromises = await import("fs/promises");

    mockExistsSync = vi.mocked(fs.existsSync);
    mockMkdirSync = vi.mocked(fs.mkdirSync);
    mockReadFileSync = vi.mocked(fs.readFileSync);
    mockWriteFile = vi.mocked(fsPromises.writeFile);

    // Default: no files exist
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue("# Template Content\nSome template text");

    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("default behavior (claude format)", () => {
    it("should create .claude/CLAUDE.md by default", async () => {
      // Template file exists, but target and .claude dir do not
      mockExistsSync.mockImplementation((p: string) => {
        if (String(p).includes("agent-quick-start.md")) return true;
        return false;
      });

      const exitCode = await initCommand({});

      expect(exitCode).toBe(0);
      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.any(String),
        "utf-8"
      );
    });
  });

  describe("agents format", () => {
    it("should create AGENTS.md with --agents flag", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (String(p).includes("agent-quick-start.md")) return true;
        return false;
      });

      const exitCode = await initCommand({ agents: true });

      expect(exitCode).toBe(0);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("AGENTS.md"),
        expect.any(String),
        "utf-8"
      );
    });
  });

  describe("existing file without force", () => {
    it("should return 0 without overwriting when file already exists", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // The target file (.claude/CLAUDE.md) exists
        if (String(p).includes("CLAUDE.md")) return true;
        return false;
      });

      const exitCode = await initCommand({});

      expect(exitCode).toBe(0);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe("force overwrite", () => {
    it("should overwrite existing file when --force is set", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        if (String(p).includes("CLAUDE.md")) return true;
        if (String(p).includes("agent-quick-start.md")) return true;
        if (String(p).includes(".claude")) return true;
        return false;
      });

      const exitCode = await initCommand({ force: true });

      expect(exitCode).toBe(0);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.any(String),
        "utf-8"
      );
    });
  });

  describe("append mode", () => {
    it("should append to existing file when --append is set", async () => {
      const existingContent = "# Existing content";
      mockExistsSync.mockImplementation((p: string) => {
        if (String(p).includes("CLAUDE.md")) return true;
        if (String(p).includes("agent-quick-start.md")) return true;
        if (String(p).includes(".claude")) return true;
        return false;
      });
      mockReadFileSync.mockImplementation((p: string) => {
        if (String(p).includes("CLAUDE.md")) return existingContent;
        return "# Template Content\nSome template text";
      });

      const exitCode = await initCommand({ append: true });

      expect(exitCode).toBe(0);
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("CLAUDE.md"),
        expect.stringContaining(existingContent),
        "utf-8"
      );
      // Should contain the separator
      const writtenContent = mockWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain("---");
    });
  });

  describe("template not found", () => {
    it("should return 1 when template file is not found", async () => {
      // No files exist at all (including the template)
      mockExistsSync.mockReturnValue(false);

      const exitCode = await initCommand({});

      expect(exitCode).toBe(1);
    });
  });
});
