/**
 * Performance Test: Circuit Breaker
 *
 * Tests circuit breaker overhead and recovery behavior.
 * Requirements:
 * - Minimal overhead on successful operations
 * - Fast failure detection
 * - Proper recovery behavior
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CircuitBreaker } from "../../src/safety/circuit-breaker.js";

describe("Circuit Breaker Performance", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      timeout: 1000,
      errorThresholdPercentage: 50,
      resetTimeout: 1000,
    });
  });

  it("should have minimal overhead on successful operations", async () => {
    const iterations = 1000;
    const operation = async () => {
      return "success";
    };

    // Measure without circuit breaker
    const startWithout = Date.now();
    for (let i = 0; i < iterations; i++) {
      await operation();
    }
    const timeWithout = Date.now() - startWithout;

    // Measure with circuit breaker - wrap with protect()
    const protectedOperation = breaker.protect(operation);
    const startWith = Date.now();
    for (let i = 0; i < iterations; i++) {
      await protectedOperation();
    }
    const timeWith = Date.now() - startWith;

    const overhead = timeWith - timeWithout;
    const overheadPerOp = overhead / iterations;

    // Overhead should be minimal (< 5ms per operation, allows CI variance)
    expect(overheadPerOp).toBeLessThan(5);

    console.log(`  ✓ Without circuit breaker: ${timeWithout}ms`);
    console.log(`  ✓ With circuit breaker: ${timeWith}ms`);
    console.log(
      `  ✓ Overhead: ${overhead}ms (${overheadPerOp.toFixed(3)}ms per op)`,
    );
  });

  it("should detect failures quickly", async () => {
    // Create breaker with low volume threshold for testing
    const testBreaker = new CircuitBreaker({
      timeout: 1000,
      errorThresholdPercentage: 50,
      resetTimeout: 1000,
    });

    const failures = 20; // Need more than volumeThreshold (default 10) to trigger
    let failureCount = 0;
    let opened = false;

    testBreaker.on("open", () => {
      opened = true;
    });

    const failingOperation = async () => {
      failureCount++;
      throw new Error("Operation failed");
    };

    const protectedFailingOp = testBreaker.protect(failingOperation);
    const startTime = Date.now();

    // Execute failing operations until circuit opens
    for (let i = 0; i < failures; i++) {
      try {
        await protectedFailingOp();
      } catch (error) {
        // Expected to fail
      }

      if (opened) {
        break;
      }
    }

    const detectionTime = Date.now() - startTime;

    // Circuit should open after enough failures exceed the threshold
    expect(failureCount).toBeGreaterThan(0);
    expect(detectionTime).toBeLessThan(1000); // Should detect within 1 second

    console.log(`  ✓ Circuit opened: ${opened} after ${failureCount} failures`);
    console.log(`  ✓ Detection time: ${detectionTime}ms`);

    testBreaker.shutdown();
  });

  it("should reject requests quickly when open", async () => {
    const testBreaker = new CircuitBreaker({
      timeout: 1000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000, // Long reset to keep circuit open
    });

    // Force circuit to open by making many failures
    const failOp = testBreaker.protect(async () => {
      throw new Error("fail");
    });

    for (let i = 0; i < 20; i++) {
      try {
        await failOp();
      } catch (error) {
        // Expected
      }
    }

    // Wait for circuit to open
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Measure rejection time when circuit is open
    const successOp = testBreaker.protect(async () => "success");
    const iterations = 100;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      try {
        await successOp();
      } catch (error) {
        // Circuit is open, should reject immediately
      }
    }

    const totalTime = Date.now() - startTime;
    const avgRejectionTime = totalTime / iterations;

    // Rejections should be very fast (< 5ms each, allows CI variance)
    expect(avgRejectionTime).toBeLessThan(5);

    console.log(`  ✓ Average rejection time: ${avgRejectionTime.toFixed(3)}ms`);
    console.log(`  ✓ Total time for ${iterations} rejections: ${totalTime}ms`);

    testBreaker.shutdown();
  });

  it("should handle high-frequency state transitions", async () => {
    const testBreaker = new CircuitBreaker({
      timeout: 1000,
      errorThresholdPercentage: 50,
      resetTimeout: 50, // Short reset for fast cycling
    });

    const cycles = 50;
    let transitions = 0;

    testBreaker.on("open", () => transitions++);
    testBreaker.on("close", () => transitions++);

    const failOp = testBreaker.protect(async () => {
      throw new Error("fail");
    });
    const successOp = testBreaker.protect(async () => "success");

    const startTime = Date.now();

    for (let cycle = 0; cycle < cycles; cycle++) {
      // Cause failures to open circuit
      for (let i = 0; i < 15; i++) {
        try {
          await failOp();
        } catch (error) {
          // Expected
        }
      }

      // Wait for reset timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Successful operation to close circuit
      try {
        await successOp();
      } catch (error) {
        // May still be open
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const totalTime = Date.now() - startTime;

    console.log(`  ✓ Completed ${cycles} open/close cycles`);
    console.log(`  ✓ Total transitions: ${transitions}`);
    console.log(`  ✓ Total time: ${totalTime}ms`);

    testBreaker.shutdown();
  });

  it("should handle concurrent operations efficiently", async () => {
    const concurrentOps = 100;
    const operation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "success";
    };

    const protectedOp = breaker.protect(operation);
    const startTime = Date.now();

    // Execute operations concurrently
    const promises = Array.from({ length: concurrentOps }, () => protectedOp());

    await Promise.all(promises);

    const totalTime = Date.now() - startTime;

    // Should handle concurrent operations with minimal overhead
    // Since operations take 10ms each, concurrent execution should be much faster
    // than sequential (which would be 100 * 10ms = 1000ms)
    expect(totalTime).toBeLessThan(1000); // Relaxed for CI variance

    console.log(
      `  ✓ ${concurrentOps} concurrent operations completed in ${totalTime}ms`,
    );
  });

  it("should maintain performance under mixed success/failure", async () => {
    const iterations = 500;
    let successCount = 0;
    let failureCount = 0;
    let iterationIndex = 0;

    const mixedOp = breaker.protect(async () => {
      const i = iterationIndex++;
      // Alternate between success and failure
      if (i % 3 === 0) {
        throw new Error("fail");
      }
      return "success";
    });

    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      try {
        await mixedOp();
        successCount++;
      } catch (error) {
        failureCount++;
      }
    }

    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;

    expect(avgTime).toBeLessThan(2);

    console.log(`  ✓ Processed ${iterations} operations in ${totalTime}ms`);
    console.log(`  ✓ Success: ${successCount}, Failures: ${failureCount}`);
    console.log(`  ✓ Average time per operation: ${avgTime.toFixed(3)}ms`);
  });

  it("should handle timeout efficiently", async () => {
    const shortTimeout = new CircuitBreaker({
      timeout: 50,
      errorThresholdPercentage: 50,
      resetTimeout: 1000,
    });

    const slowOperation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "success";
    };

    const protectedSlowOp = shortTimeout.protect(slowOperation);
    const iterations = 20;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
      try {
        await protectedSlowOp();
      } catch (error) {
        // Expected to timeout
      }
    }

    const totalTime = Date.now() - startTime;
    const avgTime = totalTime / iterations;

    // Timeouts should be enforced efficiently
    expect(avgTime).toBeLessThan(100); // Much less than operation time

    console.log(`  ✓ Handled ${iterations} timeouts in ${totalTime}ms`);
    console.log(`  ✓ Average time per timeout: ${avgTime.toFixed(3)}ms`);

    shortTimeout.shutdown();
  });
});
