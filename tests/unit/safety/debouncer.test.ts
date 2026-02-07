import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Debouncer } from "../../../src/safety/debouncer.js";

describe("Debouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create debouncer with specified delay", () => {
      const debouncer = new Debouncer(100);
      expect(debouncer).toBeDefined();
    });

    it("should create debouncer with default delay of 0", () => {
      const debouncer = new Debouncer();
      expect(debouncer).toBeDefined();
    });
  });

  describe("debounce", () => {
    it("should execute function after delay", async () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn();

      debouncer.debounce("test-key", fn);

      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledOnce();
    });

    it("should cancel previous call when same key is debounced again", async () => {
      const debouncer = new Debouncer(100);
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      debouncer.debounce("test-key", fn1);
      vi.advanceTimersByTime(50);
      debouncer.debounce("test-key", fn2);

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it("should handle multiple keys independently", async () => {
      const debouncer = new Debouncer(100);
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      debouncer.debounce("key1", fn1);
      debouncer.debounce("key2", fn2);

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it("should execute immediately when delay is 0", async () => {
      const debouncer = new Debouncer(0);
      const fn = vi.fn();

      debouncer.debounce("test-key", fn);

      vi.advanceTimersByTime(0);
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledOnce();
    });

    it("should handle async functions", async () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn(async () => {
        await Promise.resolve();
        return "done";
      });

      debouncer.debounce("test-key", fn);

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledOnce();
    });

    it("should preserve function context and arguments", async () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn((a: number, b: string) => {
        return `${a}-${b}`;
      });

      debouncer.debounce("test-key", () => fn(42, "test"));

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledWith(42, "test");
    });

    it("should handle rapid successive calls", async () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn();

      for (let i = 0; i < 10; i++) {
        debouncer.debounce("test-key", fn);
        vi.advanceTimersByTime(10);
      }

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      // Only the last call should execute
      expect(fn).toHaveBeenCalledOnce();
    });
  });

  describe("cancel", () => {
    it("should cancel pending debounced function", async () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn();

      debouncer.debounce("test-key", fn);
      debouncer.cancel("test-key");

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn).not.toHaveBeenCalled();
    });

    it("should handle canceling non-existent key", () => {
      const debouncer = new Debouncer(100);
      expect(() => debouncer.cancel("non-existent")).not.toThrow();
    });

    it("should only cancel specified key", async () => {
      const debouncer = new Debouncer(100);
      const fn1 = vi.fn();
      const fn2 = vi.fn();

      debouncer.debounce("key1", fn1);
      debouncer.debounce("key2", fn2);
      debouncer.cancel("key1");

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledOnce();
    });
  });

  describe("cancelAll", () => {
    it("should cancel all pending debounced functions", async () => {
      const debouncer = new Debouncer(100);
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      const fn3 = vi.fn();

      debouncer.debounce("key1", fn1);
      debouncer.debounce("key2", fn2);
      debouncer.debounce("key3", fn3);

      debouncer.cancelAll();

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
      expect(fn3).not.toHaveBeenCalled();
    });

    it("should handle cancelAll when no functions are pending", () => {
      const debouncer = new Debouncer(100);
      expect(() => debouncer.cancelAll()).not.toThrow();
    });
  });

  describe("isPending", () => {
    it("should return true for pending debounced function", () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn();

      debouncer.debounce("test-key", fn);

      expect(debouncer.isPending("test-key")).toBe(true);
    });

    it("should return false after function executes", async () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn();

      debouncer.debounce("test-key", fn);

      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();

      expect(debouncer.isPending("test-key")).toBe(false);
    });

    it("should return false for non-existent key", () => {
      const debouncer = new Debouncer(100);
      expect(debouncer.isPending("non-existent")).toBe(false);
    });

    it("should return false after cancellation", () => {
      const debouncer = new Debouncer(100);
      const fn = vi.fn();

      debouncer.debounce("test-key", fn);
      debouncer.cancel("test-key");

      expect(debouncer.isPending("test-key")).toBe(false);
    });
  });
});
