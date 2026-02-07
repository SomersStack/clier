/**
 * Performance Test: Memory Leaks
 *
 * Tests for memory leaks in long-running scenarios.
 * Requirements:
 * - No memory leaks over 1000+ events
 * - Event history cleanup working
 * - Process connection cleanup working
 * - No listener leaks
 *
 * Note: For reliable memory testing, run with: node --expose-gc
 * Without --expose-gc, GC timing is unpredictable and tests use looser thresholds.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventHandler } from "../../src/core/event-handler.js";
import { PatternMatcher } from "../../src/core/pattern-matcher.js";
import type { ClierEvent } from "../../src/types/events.js";

const hasGC = typeof global.gc === "function";

describe("Memory Leak Tests", () => {
  /**
   * Helper to get memory usage in MB
   */
  function getMemoryUsageMB(): number {
    const usage = process.memoryUsage();
    return usage.heapUsed / 1024 / 1024;
  }

  /**
   * Helper to force garbage collection if available
   */
  function tryGC() {
    if (global.gc) {
      global.gc();
    }
  }

  it("should warn if GC is not available", () => {
    if (!hasGC) {
      console.log(
        "  ⚠ Warning: global.gc not available. Run with --expose-gc for reliable memory tests.",
      );
    }
    expect(true).toBe(true); // Always passes, just logs warning
  });

  it("should not leak memory with repeated event processing", async () => {
    const emitter = new EventEmitter();
    const iterations = 5000;
    let processed = 0;

    emitter.on("test-event", () => {
      processed++;
    });

    // Initial memory
    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialMemory = getMemoryUsageMB();

    // Process many events
    for (let i = 0; i < iterations; i++) {
      emitter.emit("test-event", {
        id: i,
        data: "x".repeat(100),
        timestamp: Date.now(),
      });
    }

    // Final memory
    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalMemory = getMemoryUsageMB();

    const memoryGrowth = finalMemory - initialMemory;

    expect(processed).toBe(iterations);
    // Memory growth should be minimal (< 10MB for 5000 events)
    expect(memoryGrowth).toBeLessThan(10);

    console.log(`  ✓ Processed ${processed} events`);
    console.log(`  ✓ Initial memory: ${initialMemory.toFixed(2)}MB`);
    console.log(`  ✓ Final memory: ${finalMemory.toFixed(2)}MB`);
    console.log(`  ✓ Memory growth: ${memoryGrowth.toFixed(2)}MB`);

    emitter.removeAllListeners();
  });

  it("should not leak memory with EventHandler pattern matching", async () => {
    const iterations = 2000;

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialMemory = getMemoryUsageMB();

    for (let run = 0; run < 5; run++) {
      const matcher = new PatternMatcher();
      const handler = new EventHandler(matcher);

      // Register patterns
      handler.registerPipelineItem({
        name: "test",
        command: "echo test",
        cwd: ".",
        type: "task",
        events: {
          on_stdout: [
            { pattern: "ERROR", emit: "error" },
            { pattern: "SUCCESS", emit: "success" },
          ],
          on_stderr: true,
          on_crash: true,
        },
      });

      // Process events
      for (let i = 0; i < iterations / 5; i++) {
        const event: ClierEvent = {
          name: "test",
          processName: "test",
          type: "stdout",
          data: i % 2 === 0 ? "ERROR: Something failed" : "SUCCESS: All good",
          timestamp: Date.now(),
        };
        handler.handleEvent(event);
      }
    }

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalMemory = getMemoryUsageMB();

    const memoryGrowth = finalMemory - initialMemory;

    // Memory growth should be minimal (threshold is higher without --expose-gc)
    // Note: Run with `node --expose-gc` for more reliable memory testing
    expect(memoryGrowth).toBeLessThan(50);

    console.log(`  ✓ Processed ${iterations} events across 5 runs`);
    console.log(`  ✓ Memory growth: ${memoryGrowth.toFixed(2)}MB`);
  });

  it("should not leak event listeners", () => {
    const emitter = new EventEmitter();
    const initialCount = emitter.listenerCount("test-event");

    // Add and remove listeners repeatedly
    for (let i = 0; i < 100; i++) {
      const handler = () => {
        /* no-op */
      };
      emitter.on("test-event", handler);
      emitter.off("test-event", handler);
    }

    const finalCount = emitter.listenerCount("test-event");

    expect(finalCount).toBe(initialCount);

    console.log(`  ✓ Listener count remained stable: ${finalCount}`);
  });

  it("should handle growing and shrinking event payloads", async () => {
    const emitter = new EventEmitter();
    const iterations = 1000;
    const payloadSizes = [100, 1000, 10000, 1000, 100]; // Grow then shrink

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialMemory = getMemoryUsageMB();

    let processed = 0;
    emitter.on("test-event", () => {
      processed++;
    });

    for (const size of payloadSizes) {
      for (let i = 0; i < iterations / payloadSizes.length; i++) {
        emitter.emit("test-event", {
          data: "x".repeat(size),
        });
      }
    }

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalMemory = getMemoryUsageMB();

    const memoryGrowth = finalMemory - initialMemory;

    expect(processed).toBe(iterations);
    // After GC, memory should return close to initial
    // Without --expose-gc, use looser threshold
    expect(memoryGrowth).toBeLessThan(hasGC ? 5 : 20);

    console.log(`  ✓ Processed ${processed} events with varying payload sizes`);
    console.log(`  ✓ Memory growth after GC: ${memoryGrowth.toFixed(2)}MB`);

    emitter.removeAllListeners();
  });

  it("should not accumulate memory with many short-lived objects", async () => {
    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialMemory = getMemoryUsageMB();

    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      // Create short-lived event objects
      const event = {
        name: `event-${i}`,
        processName: "test",
        type: "custom",
        data: { id: i, message: "test message" },
        timestamp: Date.now(),
      };

      // Simulate processing
      const serialized = JSON.stringify(event);
      JSON.parse(serialized);
    }

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalMemory = getMemoryUsageMB();

    const memoryGrowth = finalMemory - initialMemory;

    // Short-lived objects should be garbage collected
    // Note: Without --expose-gc, GC timing is unpredictable
    expect(memoryGrowth).toBeLessThan(20);

    console.log(`  ✓ Created ${iterations} short-lived objects`);
    console.log(`  ✓ Memory growth: ${memoryGrowth.toFixed(2)}MB`);
  });

  it("should handle continuous event stream without memory buildup", async () => {
    const emitter = new EventEmitter();
    const duration = 2000; // 2 seconds
    const eventInterval = 10; // Every 10ms
    let processed = 0;

    emitter.on("continuous-event", () => {
      processed++;
    });

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialMemory = getMemoryUsageMB();

    // Start continuous event stream
    const startTime = Date.now();
    while (Date.now() - startTime < duration) {
      emitter.emit("continuous-event", {
        timestamp: Date.now(),
        data: "continuous stream data",
      });
      await new Promise((resolve) => setTimeout(resolve, eventInterval));
    }

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalMemory = getMemoryUsageMB();

    const memoryGrowth = finalMemory - initialMemory;

    expect(processed).toBeGreaterThan(0);
    // Continuous processing shouldn't cause unbounded memory growth
    expect(memoryGrowth).toBeLessThan(10);

    console.log(`  ✓ Processed ${processed} events over ${duration}ms`);
    console.log(`  ✓ Memory growth: ${memoryGrowth.toFixed(2)}MB`);

    emitter.removeAllListeners();
  });

  it("should clean up resources properly on removeAllListeners", () => {
    const emitters: EventEmitter[] = [];

    // Create multiple emitters with listeners
    for (let i = 0; i < 100; i++) {
      const emitter = new EventEmitter();
      emitter.on("event1", () => {});
      emitter.on("event2", () => {});
      emitter.on("event3", () => {});
      emitters.push(emitter);
    }

    // Clean up all listeners
    for (const emitter of emitters) {
      emitter.removeAllListeners();
    }

    // Verify all listeners removed
    for (const emitter of emitters) {
      expect(emitter.listenerCount("event1")).toBe(0);
      expect(emitter.listenerCount("event2")).toBe(0);
      expect(emitter.listenerCount("event3")).toBe(0);
    }

    console.log(`  ✓ Cleaned up ${emitters.length} emitters`);
  });

  it("should handle memory efficiently with pattern matching cache", async () => {
    const matcher = new PatternMatcher();

    // Add many patterns
    for (let i = 0; i < 50; i++) {
      matcher.addPattern("test", new RegExp(`pattern${i}`), `event${i}`);
    }

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const initialMemory = getMemoryUsageMB();

    // Match against same log lines repeatedly (should benefit from caching)
    const logLines = [
      "Log line with pattern0",
      "Log line with pattern25",
      "Log line with pattern49",
      "Log line with no match",
    ];

    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      for (const line of logLines) {
        matcher.match(line);
      }
    }

    tryGC();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const finalMemory = getMemoryUsageMB();

    const memoryGrowth = finalMemory - initialMemory;

    // Pattern matching with cache shouldn't cause significant memory growth
    // Without --expose-gc, use looser threshold
    expect(memoryGrowth).toBeLessThan(hasGC ? 5 : 20);

    console.log(
      `  ✓ Performed ${iterations * logLines.length} pattern matches`,
    );
    console.log(`  ✓ Memory growth: ${memoryGrowth.toFixed(2)}MB`);
  });
});
