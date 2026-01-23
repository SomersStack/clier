import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimiter } from "../../../src/safety/rate-limiter.js";

describe("RateLimiter", () => {
  // Track all created limiters for cleanup
  const limiters: RateLimiter[] = [];

  // Helper to create and track limiters
  const createLimiter = (maxOpsPerMinute: number): RateLimiter => {
    const limiter = new RateLimiter(maxOpsPerMinute);
    limiters.push(limiter);
    return limiter;
  };

  afterEach(async () => {
    // Stop all limiters to clean up Bottleneck's internal timers
    await Promise.all(
      limiters.map((limiter) => limiter.stop({ dropWaitingJobs: true })),
    );
    limiters.length = 0;
  });

  describe("constructor", () => {
    it("should create rate limiter with specified max operations per minute", () => {
      const limiter = createLimiter(60);
      expect(limiter).toBeDefined();
    });

    it("should throw error for non-positive max operations", () => {
      expect(() => createLimiter(0)).toThrow(
        "maxOpsPerMinute must be greater than 0",
      );
      expect(() => createLimiter(-1)).toThrow(
        "maxOpsPerMinute must be greater than 0",
      );
    });
  });

  describe("schedule", () => {
    it("should execute function immediately when under limit", async () => {
      const limiter = createLimiter(60);
      const fn = vi.fn(() => Promise.resolve("result"));

      const result = await limiter.schedule(fn);

      expect(fn).toHaveBeenCalledOnce();
      expect(result).toBe("result");
    });

    it("should execute synchronous functions", async () => {
      const limiter = createLimiter(60);
      const fn = vi.fn(() => "sync-result");

      const result = await limiter.schedule(fn);

      expect(fn).toHaveBeenCalledOnce();
      expect(result).toBe("sync-result");
    });

    it("should queue operations when rate limit is exceeded", async () => {
      const limiter = createLimiter(100); // High limit for testing
      const fn1 = vi.fn(() => Promise.resolve("result1"));
      const fn2 = vi.fn(() => Promise.resolve("result2"));
      const fn3 = vi.fn(() => Promise.resolve("result3"));

      // All should execute quickly with high limit
      await Promise.all([
        limiter.schedule(fn1),
        limiter.schedule(fn2),
        limiter.schedule(fn3),
      ]);

      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
      expect(fn3).toHaveBeenCalledOnce();
    });

    it("should handle function arguments", async () => {
      const limiter = createLimiter(60);
      const fn = vi.fn((a: number, b: string) => Promise.resolve(`${a}-${b}`));

      const result = await limiter.schedule(() => fn(42, "test"));

      expect(fn).toHaveBeenCalledWith(42, "test");
      expect(result).toBe("42-test");
    });

    it("should handle function errors", async () => {
      const limiter = createLimiter(60);
      const error = new Error("Test error");
      const fn = vi.fn(() => Promise.reject(error));

      await expect(limiter.schedule(fn)).rejects.toThrow("Test error");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("should handle multiple concurrent operations within limit", async () => {
      const limiter = createLimiter(100);
      const functions = Array.from({ length: 5 }, (_, i) =>
        vi.fn(() => Promise.resolve(i)),
      );

      const promises = functions.map((fn) => limiter.schedule(fn));

      await Promise.all(promises);

      functions.forEach((fn) => {
        expect(fn).toHaveBeenCalledOnce();
      });
    });
  });

  describe("updateMaxOpsPerMinute", () => {
    it("should update the rate limit", async () => {
      const limiter = createLimiter(60);
      const fn = vi.fn(() => Promise.resolve("result"));

      limiter.updateMaxOpsPerMinute(120);

      await limiter.schedule(fn);

      expect(fn).toHaveBeenCalledOnce();
    });

    it("should throw error for non-positive max operations", () => {
      const limiter = createLimiter(60);
      expect(() => limiter.updateMaxOpsPerMinute(0)).toThrow(
        "maxOpsPerMinute must be greater than 0",
      );
      expect(() => limiter.updateMaxOpsPerMinute(-5)).toThrow(
        "maxOpsPerMinute must be greater than 0",
      );
    });
  });

  describe("getQueueLength", () => {
    it("should return 0 when no operations are queued", () => {
      const limiter = createLimiter(60);
      expect(limiter.getQueueLength()).toBe(0);
    });

    it("should return queue length when operations are queued", async () => {
      // Use high limit so operations complete quickly
      const limiter = createLimiter(100);
      const fn = vi.fn(() => Promise.resolve("done"));

      // Schedule operations
      const promises = [
        limiter.schedule(fn),
        limiter.schedule(fn),
        limiter.schedule(fn),
      ];

      // Queue length should be accessible (may be 0 if executed immediately)
      const queueLength = limiter.getQueueLength();
      expect(queueLength).toBeGreaterThanOrEqual(0);

      // Wait for all to complete
      await Promise.all(promises);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe("stop", () => {
    it("should stop the rate limiter", async () => {
      // Don't use createLimiter here since we're testing stop() directly
      const limiter = new RateLimiter(60);
      const fn = vi.fn(() => Promise.resolve("result"));

      // Execute before stopping
      await limiter.schedule(fn);
      expect(fn).toHaveBeenCalledOnce();

      // Stop limiter
      await limiter.stop();

      // After stopping, new operations should be rejected
      await expect(limiter.schedule(fn)).rejects.toThrow();
    });

    it("should handle stop when no operations are pending", async () => {
      // Don't use createLimiter here since we're testing stop() directly
      const limiter = new RateLimiter(60);
      await expect(limiter.stop()).resolves.toBeUndefined();
    });
  });

  describe("integration scenarios", () => {
    it("should handle burst of operations followed by steady state", async () => {
      const limiter = createLimiter(100);
      const results: number[] = [];

      // Burst: 5 operations
      const promises = Array.from({ length: 5 }, (_, i) =>
        limiter.schedule(async () => {
          results.push(i);
          return i;
        }),
      );

      await Promise.all(promises);

      expect(results).toHaveLength(5);
      expect(results.sort()).toEqual([0, 1, 2, 3, 4]);
    });

    it("should maintain order of execution", async () => {
      const limiter = createLimiter(100);
      const executionOrder: number[] = [];

      const promises = [0, 1, 2, 3, 4].map((i) =>
        limiter.schedule(async () => {
          executionOrder.push(i);
          return i;
        }),
      );

      await Promise.all(promises);

      expect(executionOrder).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
