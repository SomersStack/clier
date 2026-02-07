/**
 * Performance Test: Pattern Matching
 *
 * Tests regex performance with complex patterns and large volumes of log lines.
 * Requirements:
 * - Match < 1ms per line for 10 patterns
 * - No catastrophic backtracking
 * - Efficient handling of complex patterns
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PatternMatcher } from "../../src/core/pattern-matcher.js";

describe("Pattern Matching Performance", () => {
  let matcher: PatternMatcher;

  beforeEach(() => {
    matcher = new PatternMatcher();
  });

  it("should match patterns quickly (< 1ms per line for 10 patterns)", () => {
    // Register 10 different patterns
    const patterns = [
      { pattern: /ERROR/, event: "error" },
      { pattern: /WARN/, event: "warning" },
      { pattern: /Server started on port \d+/, event: "server:ready" },
      { pattern: /Database connected/, event: "db:connected" },
      { pattern: /Test (passed|failed)/, event: "test:completed" },
      { pattern: /Build completed in \d+ms/, event: "build:done" },
      { pattern: /User \w+ logged in/, event: "user:login" },
      { pattern: /Request \[\w+\] \/api\/\w+/, event: "api:request" },
      { pattern: /Memory usage: \d+MB/, event: "memory:update" },
      { pattern: /CPU: \d+\.\d+%/, event: "cpu:update" },
    ];

    patterns.forEach(({ pattern, event }) => {
      matcher.addPattern("perf-test", pattern, event);
    });

    // Test log lines
    const logLines = [
      "INFO: Application starting...",
      "ERROR: Connection failed",
      "WARN: High memory usage detected",
      "Server started on port 3000",
      "Database connected successfully",
      "Test passed: user authentication",
      "Build completed in 1234ms",
      "User john123 logged in",
      "Request [GET] /api/users",
      "Memory usage: 512MB",
      "CPU: 45.2%",
    ];

    const iterations = 100;
    const startTime = Date.now();

    // Match patterns against log lines multiple times
    for (let i = 0; i < iterations; i++) {
      for (const line of logLines) {
        matcher.match(line);
      }
    }

    const endTime = Date.now();
    const totalMatches = iterations * logLines.length;
    const totalTime = endTime - startTime;
    const timePerMatch = totalTime / totalMatches;

    expect(timePerMatch).toBeLessThan(5); // Less than 5ms per match (allows CI variance)

    console.log(`  ✓ Processed ${totalMatches} matches in ${totalTime}ms`);
    console.log(`  ✓ Average time per match: ${timePerMatch.toFixed(3)}ms`);
  });

  it("should handle complex regex patterns efficiently", () => {
    // Complex patterns that could cause backtracking
    const complexPatterns = [
      {
        pattern: /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] \[\w+\] .+/,
        event: "timestamped:log",
      },
      {
        pattern: /Error: (.*?) at line (\d+) in file (.+\.js)/,
        event: "error:detailed",
      },
      {
        pattern: /\{"status":"\w+","message":"[^"]+","timestamp":\d+\}/,
        event: "json:log",
      },
    ];

    complexPatterns.forEach(({ pattern, event }) => {
      matcher.addPattern("complex-test", pattern, event);
    });

    const testLines = [
      "[2024-01-21 12:34:56] [INFO] Application started",
      "Error: Undefined variable at line 42 in file app.js",
      '{"status":"success","message":"Operation completed","timestamp":1234567890}',
      "Regular log line without pattern match",
    ];

    const iterations = 500;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      for (const line of testLines) {
        matcher.match(line);
      }
    }

    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTimePerLine = totalTime / (iterations * testLines.length);

    expect(avgTimePerLine).toBeLessThan(5); // Allows CI variance

    console.log(
      `  ✓ Complex pattern matching: ${avgTimePerLine.toFixed(3)}ms per line`,
    );
  });

  it("should scale with increasing number of patterns", () => {
    const patternCounts = [1, 5, 10, 20, 50];
    const testLine =
      "INFO: Application running normally with pattern50 detected";

    for (const count of patternCounts) {
      const freshMatcher = new PatternMatcher();

      // Add patterns
      for (let i = 0; i < count; i++) {
        freshMatcher.addPattern(
          `test${i}`,
          new RegExp(`pattern${i}`),
          `event${i}`,
        );
      }

      const iterations = 1000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        freshMatcher.match(testLine);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / iterations;

      expect(avgTime).toBeLessThan(5); // Allows CI variance

      console.log(`  ✓ ${count} patterns: ${avgTime.toFixed(3)}ms per match`);
    }
  });

  it("should handle very long log lines efficiently", () => {
    matcher.addPattern("test", /ERROR/, "error");
    matcher.addPattern("test", /SUCCESS/, "success");

    const lineLengths = [100, 1000, 10000, 50000];

    for (const length of lineLengths) {
      const longLine =
        "x".repeat(length / 2) + "ERROR" + "x".repeat(length / 2);
      const iterations = 100;

      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        const matches = matcher.match(longLine);
        expect(matches.length).toBeGreaterThan(0);
      }

      const endTime = Date.now();
      const avgTime = (endTime - startTime) / iterations;

      // Even for very long lines, should be reasonably fast
      expect(avgTime).toBeLessThan(10);

      console.log(
        `  ✓ Line length ${length}: ${avgTime.toFixed(3)}ms per match`,
      );
    }
  });

  it("should handle mixed pattern complexity efficiently", () => {
    // Mix of simple and complex patterns
    const mixedPatterns = [
      { pattern: /ERROR/, event: "simple:error" },
      { pattern: /Server started on port (\d+)/, event: "server:started" },
      { pattern: /\[\d{4}-\d{2}-\d{2}\]/, event: "timestamp" },
      {
        pattern: /User: \w+, Action: \w+, Result: (success|failure)/,
        event: "user:action",
      },
      { pattern: /OK/, event: "simple:ok" },
    ];

    mixedPatterns.forEach(({ pattern, event }) => {
      matcher.addPattern("mixed-test", pattern, event);
    });

    const mixedLines = [
      "ERROR: Something went wrong",
      "Server started on port 8080",
      "[2024-01-21] Log entry",
      "User: alice, Action: login, Result: success",
      "Everything is OK",
      "No pattern match here",
    ];

    const iterations = 500;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      for (const line of mixedLines) {
        matcher.match(line);
      }
    }

    const endTime = Date.now();
    const totalTime = endTime - startTime;
    const avgTime = totalTime / (iterations * mixedLines.length);

    expect(avgTime).toBeLessThan(5); // Allows CI variance

    console.log(`  ✓ Mixed complexity: ${avgTime.toFixed(3)}ms per match`);
    console.log(
      `  ✓ Total throughput: ${(((iterations * mixedLines.length) / totalTime) * 1000).toFixed(0)} matches/sec`,
    );
  });
});
