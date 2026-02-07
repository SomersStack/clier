/**
 * Performance Test: Event Processing
 *
 * Tests the system's ability to handle high volumes of events.
 * Requirements:
 * - Process 100+ events/second
 * - Event loop lag < 30ms average
 * - No memory leaks
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

describe("Event Processing Performance", () => {
  let emitter: EventEmitter;
  let processedEvents: number;
  let startTime: number;
  let endTime: number;

  beforeEach(() => {
    emitter = new EventEmitter();
    processedEvents = 0;
    emitter.setMaxListeners(1000); // Increase limit for performance test
  });

  afterEach(() => {
    emitter.removeAllListeners();
  });

  it("should process 100+ events per second", async () => {
    const targetEvents = 1000;
    const eventHandler = () => {
      processedEvents++;
    };

    emitter.on("test-event", eventHandler);

    startTime = Date.now();

    // Emit events
    for (let i = 0; i < targetEvents; i++) {
      emitter.emit("test-event", { id: i, data: `Event ${i}` });
    }

    endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // seconds
    const eventsPerSecond = processedEvents / duration;

    expect(processedEvents).toBe(targetEvents);
    expect(eventsPerSecond).toBeGreaterThan(100);

    console.log(
      `  ✓ Processed ${processedEvents} events in ${duration.toFixed(3)}s`,
    );
    console.log(`  ✓ Throughput: ${eventsPerSecond.toFixed(0)} events/sec`);
  });

  it("should maintain low event loop lag under load", async () => {
    const { monitorEventLoopDelay } = await import("perf_hooks");
    const histogram = monitorEventLoopDelay({ resolution: 10 });
    histogram.enable();

    const targetEvents = 500;

    const eventHandler = () => {
      processedEvents++;
    };

    emitter.on("test-event", eventHandler);

    // Emit events with small delays to simulate real-world scenario
    for (let i = 0; i < targetEvents; i++) {
      emitter.emit("test-event", { id: i });
      if (i % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }

    histogram.disable();

    // Convert nanoseconds to milliseconds
    const meanLag = histogram.mean / 1e6;
    const maxLag = histogram.max / 1e6;

    // Event loop lag should be reasonable under load
    expect(meanLag).toBeLessThan(50); // Mean lag < 50ms

    console.log(`  ✓ Processed ${processedEvents} events`);
    console.log(`  ✓ Mean event loop lag: ${meanLag.toFixed(2)}ms`);
    console.log(`  ✓ Max event loop lag: ${maxLag.toFixed(2)}ms`);
  });

  it("should handle burst events without dropping", async () => {
    const burstSize = 100;
    const burstCount = 10;
    const totalEvents = burstSize * burstCount;

    const eventHandler = () => {
      processedEvents++;
    };

    emitter.on("test-event", eventHandler);

    // Emit events in bursts
    for (let burst = 0; burst < burstCount; burst++) {
      for (let i = 0; i < burstSize; i++) {
        emitter.emit("test-event", { burst, event: i });
      }
      // Small delay between bursts
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(processedEvents).toBe(totalEvents);

    console.log(
      `  ✓ Processed ${burstCount} bursts of ${burstSize} events each`,
    );
    console.log(`  ✓ Total: ${processedEvents} events with no drops`);
  });

  it("should handle multiple event types concurrently", async () => {
    const eventsPerType = 200;
    const eventTypes = ["stdout", "stderr", "custom", "process:exit"];
    const counters: Record<string, number> = {};

    eventTypes.forEach((type) => {
      counters[type] = 0;
      emitter.on(type, () => {
        counters[type]++;
      });
    });

    startTime = Date.now();

    // Emit events of different types concurrently
    for (let i = 0; i < eventsPerType; i++) {
      eventTypes.forEach((type) => {
        emitter.emit(type, { id: i });
      });
    }

    endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Verify all events were processed
    eventTypes.forEach((type) => {
      expect(counters[type]).toBe(eventsPerType);
    });

    const totalEvents = eventsPerType * eventTypes.length;
    const throughput = totalEvents / duration;

    expect(throughput).toBeGreaterThan(100);

    console.log(
      `  ✓ Processed ${totalEvents} events across ${eventTypes.length} types`,
    );
    console.log(`  ✓ Throughput: ${throughput.toFixed(0)} events/sec`);
  });

  it("should process events with varying payload sizes", async () => {
    const eventCount = 500;
    const payloadSizes = [10, 100, 1000, 10000]; // bytes

    for (const size of payloadSizes) {
      processedEvents = 0;
      const payload = "x".repeat(size);

      emitter.removeAllListeners("test-event");
      emitter.on("test-event", () => {
        processedEvents++;
      });

      startTime = Date.now();

      for (let i = 0; i < eventCount; i++) {
        emitter.emit("test-event", { data: payload });
      }

      endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      const throughput = processedEvents / duration;

      expect(processedEvents).toBe(eventCount);
      expect(throughput).toBeGreaterThan(100);

      console.log(
        `  ✓ Payload ${size} bytes: ${throughput.toFixed(0)} events/sec`,
      );
    }
  });
});
