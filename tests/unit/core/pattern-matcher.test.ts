import { describe, it, expect, beforeEach } from "vitest";
import { PatternMatcher } from "../../../src/core/pattern-matcher.js";

describe("PatternMatcher", () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  describe("addPattern", () => {
    it("should add a pattern successfully", () => {
      matcher.addPattern("test", /ready/, "app:ready");
      const matches = matcher.match("Server is ready");
      expect(matches).toContain("app:ready");
    });

    it("should add multiple patterns for the same name", () => {
      matcher.addPattern("test", /ready/, "app:ready");
      matcher.addPattern("test", /listening/, "app:listening");

      expect(matcher.match("Server is ready")).toContain("app:ready");
      expect(matcher.match("Server listening on port 3000")).toContain(
        "app:listening",
      );
    });
  });

  describe("match", () => {
    beforeEach(() => {
      matcher.addPattern(
        "backend",
        /Server listening on port (\d+)/,
        "backend:ready",
      );
      matcher.addPattern(
        "backend",
        /Database connected/,
        "backend:db-connected",
      );
      matcher.addPattern("frontend", /Compiled successfully/, "frontend:ready");
      matcher.addPattern("build", /Build complete/, "build:success");
    });

    it("should return empty array when no patterns match", () => {
      const matches = matcher.match("Random log message");
      expect(matches).toEqual([]);
    });

    it("should return single match when one pattern matches", () => {
      const matches = matcher.match("Server listening on port 3000");
      expect(matches).toEqual(["backend:ready"]);
    });

    it("should return ALL matching events when multiple patterns match", () => {
      matcher.addPattern("test", /Server/, "test:server");
      matcher.addPattern("test", /listening/, "test:listening");

      const matches = matcher.match("Server listening on port 3000");
      expect(matches).toContain("backend:ready");
      expect(matches).toContain("test:server");
      expect(matches).toContain("test:listening");
      expect(matches.length).toBe(3);
    });

    it("should handle case-sensitive patterns correctly", () => {
      matcher.addPattern("test", /READY/, "test:uppercase");

      expect(matcher.match("READY")).toContain("test:uppercase");
      expect(matcher.match("ready")).toEqual([]);
    });

    it("should handle case-insensitive patterns", () => {
      matcher.addPattern("test", /ready/i, "test:ready");

      expect(matcher.match("READY")).toContain("test:ready");
      expect(matcher.match("ready")).toContain("test:ready");
      expect(matcher.match("ReAdY")).toContain("test:ready");
    });

    it("should match complex regex patterns", () => {
      matcher.addPattern(
        "test",
        /^Build #(\d+) completed in (\d+)ms$/,
        "build:done",
      );

      expect(matcher.match("Build #42 completed in 1234ms")).toContain(
        "build:done",
      );
      expect(matcher.match("Build #42 completed in 1234ms extra")).toEqual([]);
    });

    it("should handle multiline text by matching line by line", () => {
      const text =
        "Starting server...\nServer listening on port 3000\nDatabase connected";
      const matches = matcher.match(text);

      expect(matches).toContain("backend:ready");
      expect(matches).toContain("backend:db-connected");
    });

    it("should not duplicate events when same pattern matches multiple times in same text", () => {
      matcher.addPattern("test", /error/, "app:error");

      const matches = matcher.match("error: foo\nerror: bar\nerror: baz");
      // Should only emit event once per match call
      expect(matches.filter((m) => m === "app:error").length).toBe(1);
    });

    it("should handle empty text", () => {
      expect(matcher.match("")).toEqual([]);
    });

    it("should handle special regex characters in patterns", () => {
      matcher.addPattern("test", /\[INFO\] Ready/, "app:ready");

      expect(matcher.match("[INFO] Ready")).toContain("app:ready");
      expect(matcher.match("INFO Ready")).toEqual([]);
    });
  });

  describe("removePatterns", () => {
    it("should remove all patterns for a given name", () => {
      matcher.addPattern("test", /ready/, "app:ready");
      matcher.addPattern("test", /listening/, "app:listening");
      matcher.addPattern("other", /foo/, "other:foo");

      matcher.removePatterns("test");

      expect(matcher.match("ready")).toEqual([]);
      expect(matcher.match("listening")).toEqual([]);
      expect(matcher.match("foo")).toContain("other:foo");
    });

    it("should handle removing non-existent pattern name", () => {
      matcher.removePatterns("non-existent");
      // Should not throw
      expect(matcher.match("test")).toEqual([]);
    });
  });

  describe("clear", () => {
    it("should remove all patterns", () => {
      matcher.addPattern("test1", /ready/, "app:ready");
      matcher.addPattern("test2", /listening/, "app:listening");

      matcher.clear();

      expect(matcher.match("ready")).toEqual([]);
      expect(matcher.match("listening")).toEqual([]);
    });
  });

  describe("getPatternCount", () => {
    it("should return total number of patterns", () => {
      expect(matcher.getPatternCount()).toBe(0);

      matcher.addPattern("test1", /ready/, "app:ready");
      expect(matcher.getPatternCount()).toBe(1);

      matcher.addPattern("test2", /listening/, "app:listening");
      expect(matcher.getPatternCount()).toBe(2);

      matcher.addPattern("test2", /done/, "app:done");
      expect(matcher.getPatternCount()).toBe(3);
    });
  });
});
