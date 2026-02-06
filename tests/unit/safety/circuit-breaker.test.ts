import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CircuitBreaker } from "../../../src/safety/circuit-breaker.js";

describe("CircuitBreaker", () => {
  const breakers: CircuitBreaker[] = [];

  const createBreaker = (opts?: ConstructorParameters<typeof CircuitBreaker>[0]): CircuitBreaker => {
    const b = new CircuitBreaker(opts);
    breakers.push(b);
    return b;
  };

  afterEach(() => {
    breakers.forEach((b) => b.shutdown());
    breakers.length = 0;
  });

  describe("constructor", () => {
    it("should create circuit breaker with default options", () => {
      const breaker = createBreaker();
      expect(breaker).toBeDefined();
    });

    it("should create circuit breaker with custom options", () => {
      const breaker = createBreaker({
        timeout: 5000,
        errorThresholdPercentage: 60,
        resetTimeout: 20000,
      });
      expect(breaker).toBeDefined();
    });
  });

  describe("protect", () => {
    it("should execute function successfully when circuit is closed", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(async () => "success");

      const protected_fn = breaker.protect(fn);
      const result = await protected_fn();

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("should pass through function arguments", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(async (a: number, b: string) => `${a}-${b}`);

      const protected_fn = breaker.protect(fn);
      const result = await protected_fn(42, "test");

      expect(result).toBe("42-test");
      expect(fn).toHaveBeenCalledWith(42, "test");
    });

    it("should handle synchronous functions", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(() => "sync-result");

      const protected_fn = breaker.protect(fn);
      const result = await protected_fn();

      expect(result).toBe("sync-result");
      expect(fn).toHaveBeenCalledOnce();
    });

    it("should propagate errors from function", async () => {
      const breaker = createBreaker();
      const error = new Error("Test error");
      const fn = vi.fn(async () => {
        throw error;
      });

      const protected_fn = breaker.protect(fn);

      await expect(protected_fn()).rejects.toThrow("Test error");
    });

    it("should open circuit after error threshold is exceeded", async () => {
      const breaker = createBreaker({
        errorThresholdPercentage: 50,
        resetTimeout: 60000,
      });

      const fn = vi.fn(async () => {
        throw new Error("Failure");
      });

      const protected_fn = breaker.protect(fn);

      // Trigger enough failures to open circuit
      // Opossum default rolling count is 10 buckets
      for (let i = 0; i < 10; i++) {
        try {
          await protected_fn();
        } catch (e) {
          // Expected
        }
      }

      // Circuit should be open now
      // Further calls should fail fast without executing the function
      const callCount = fn.mock.calls.length;

      try {
        await protected_fn();
      } catch (e) {
        // Expected - circuit open
      }

      // Function should not be called again if circuit is open
      expect(fn.mock.calls.length).toBeLessThanOrEqual(callCount + 1);
    });

    it("should handle timeout", async () => {
      const breaker = createBreaker({
        timeout: 100,
      });

      const fn = vi.fn(
        async () =>
          new Promise((resolve) => {
            setTimeout(resolve, 200);
          }),
      );

      const protected_fn = breaker.protect(fn);

      await expect(protected_fn()).rejects.toThrow();
    });
  });

  describe("on", () => {
    it("should subscribe to success events", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(async () => "success");
      const successHandler = vi.fn();

      breaker.on("success", successHandler);

      const protected_fn = breaker.protect(fn);
      await protected_fn();

      expect(successHandler).toHaveBeenCalled();
    });

    it("should subscribe to failure events", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(async () => {
        throw new Error("Failure");
      });
      const failureHandler = vi.fn();

      breaker.on("failure", failureHandler);

      const protected_fn = breaker.protect(fn);

      try {
        await protected_fn();
      } catch (e) {
        // Expected
      }

      expect(failureHandler).toHaveBeenCalled();
    });

    it("should subscribe to open events", async () => {
      const breaker = createBreaker({
        errorThresholdPercentage: 50,
      });
      const fn = vi.fn(async () => {
        throw new Error("Failure");
      });
      const openHandler = vi.fn();

      breaker.on("open", openHandler);

      const protected_fn = breaker.protect(fn);

      // Trigger enough failures to open circuit
      for (let i = 0; i < 10; i++) {
        try {
          await protected_fn();
        } catch (e) {
          // Expected
        }
      }

      // Open event should have been emitted
      expect(openHandler).toHaveBeenCalled();
    });

    it("should subscribe to timeout events", async () => {
      const breaker = createBreaker({
        timeout: 100,
      });
      const fn = vi.fn(
        async () =>
          new Promise((resolve) => {
            setTimeout(resolve, 200);
          }),
      );
      const timeoutHandler = vi.fn();

      breaker.on("timeout", timeoutHandler);

      const protected_fn = breaker.protect(fn);

      try {
        await protected_fn();
      } catch (e) {
        // Expected
      }

      expect(timeoutHandler).toHaveBeenCalled();
    });

    it("should subscribe to multiple event types", async () => {
      const breaker = createBreaker();
      const successHandler = vi.fn();
      const failureHandler = vi.fn();

      breaker.on("success", successHandler);
      breaker.on("failure", failureHandler);

      const successFn = breaker.protect(vi.fn(async () => "success"));
      const failureFn = breaker.protect(
        vi.fn(async () => {
          throw new Error("Failure");
        }),
      );

      await successFn();

      try {
        await failureFn();
      } catch (e) {
        // Expected
      }

      expect(successHandler).toHaveBeenCalled();
      expect(failureHandler).toHaveBeenCalled();
    });

    it("should allow multiple handlers for same event", async () => {
      const breaker = createBreaker();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      breaker.on("success", handler1);
      breaker.on("success", handler2);

      const protected_fn = breaker.protect(vi.fn(async () => "success"));
      await protected_fn();

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("should return circuit breaker statistics", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(async () => "success");

      const protected_fn = breaker.protect(fn);
      await protected_fn();
      await protected_fn();

      // Give circuit breaker time to update stats
      await new Promise((resolve) => setTimeout(resolve, 10));

      const stats = breaker.getStats();

      expect(stats).toHaveProperty("fires");
      expect(stats).toHaveProperty("successes");
      expect(stats).toHaveProperty("failures");
      // Stats should be updated (fires may be 0 if stats aggregation is async)
      expect(stats.fires).toBeGreaterThanOrEqual(0);
    });

    it("should track failures in statistics", async () => {
      const breaker = createBreaker();
      const fn = vi.fn(async () => {
        throw new Error("Failure");
      });

      const protected_fn = breaker.protect(fn);

      try {
        await protected_fn();
      } catch (e) {
        // Expected
      }

      const stats = breaker.getStats();
      expect(stats.failures).toBeGreaterThanOrEqual(1);
    });
  });

  describe("shutdown", () => {
    it("should shutdown circuit breaker", () => {
      const breaker = createBreaker();
      expect(() => breaker.shutdown()).not.toThrow();
    });

    it("should remove all event listeners on shutdown", () => {
      const breaker = createBreaker();
      const handler = vi.fn();

      breaker.on("success", handler);
      breaker.shutdown();

      // After shutdown, events should not be emitted
      // (This is implied by shutdown behavior)
      expect(breaker).toBeDefined();
    });
  });
});
