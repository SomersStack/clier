/**
 * Unit tests for the docs command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { docsCommand } from "../../../../src/cli/commands/docs.js";

// Mock fs
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => "# Documentation Content"),
  };
});

// Mock chalk to pass through strings for easier assertion
vi.mock("chalk", () => {
  const handler: ProxyHandler<any> = {
    get(_target, _prop) {
      const fn = (...args: any[]) => args.join("");
      return new Proxy(fn, handler);
    },
    apply(_target, _thisArg, args) {
      return args.join("");
    },
  };
  return { default: new Proxy((...args: any[]) => args.join(""), handler) };
});

describe("Docs Command", () => {
  let mockReadFileSync: any;

  beforeEach(async () => {
    const fs = await import("fs");
    mockReadFileSync = vi.mocked(fs.readFileSync);
    mockReadFileSync.mockReturnValue("# Documentation Content");

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("list subjects", () => {
    it("should list available documentation subjects and return 0", async () => {
      const exitCode = await docsCommand({ list: true });

      expect(exitCode).toBe(0);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe("show specific subject", () => {
    it("should show documentation for a specific subject and return 0", async () => {
      const exitCode = await docsCommand({ subject: "commands" });

      expect(exitCode).toBe(0);
      expect(mockReadFileSync).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Documentation Content")
      );
    });
  });

  describe("unknown subject", () => {
    it("should return 1 for an unknown subject", async () => {
      const exitCode = await docsCommand({ subject: "nonexistent" });

      expect(exitCode).toBe(1);
    });
  });

  describe("show all (default)", () => {
    it("should show all documentation when no subject is specified", async () => {
      const exitCode = await docsCommand({});

      expect(exitCode).toBe(0);
      expect(mockReadFileSync).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe("empty content", () => {
    it("should return 1 when documentation files cannot be read", async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error("File not found");
      });

      const exitCode = await docsCommand({ subject: "commands" });

      expect(exitCode).toBe(1);
    });
  });
});
