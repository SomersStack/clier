import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventBus } from "../../../src/core/event-bus.js";
import { ProcessManager } from "../../../src/core/process-manager.js";
import type { ClierEvent } from "../../../src/types/events.js";

describe("EventBus", () => {
  let processManager: ProcessManager;
  let bus: EventBus;

  beforeEach(() => {
    processManager = new ProcessManager();
    bus = new EventBus(processManager);
  });

  afterEach(async () => {
    await bus.disconnect();
    await processManager.shutdown(1000);
  });

  describe("connect", () => {
    it("should connect to ProcessManager", async () => {
      await bus.connect();
      // No error means success - connection is synchronous with new implementation
    });

    it("should not connect twice if already connected", async () => {
      await bus.connect();
      await bus.connect();
      // No error means success
    });
  });

  describe("disconnect", () => {
    it("should disconnect from event bus", async () => {
      await bus.connect();
      await bus.disconnect();
      // No error means success
    });

    it("should handle disconnect when not connected", async () => {
      await expect(bus.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("event normalization", () => {
    beforeEach(async () => {
      await bus.connect();
    });

    it("should normalize stdout events", async () => {
      const stdoutPromise = new Promise<ClierEvent>((resolve) => {
        bus.on("stdout", resolve);
      });

      await processManager.startProcess({
        name: "test-stdout",
        command: "echo hello",
        type: "task",
      });

      const event = await stdoutPromise;
      expect(event.type).toBe("stdout");
      expect(event.processName).toBe("test-stdout");
      expect(event.data).toBe("hello");
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("should normalize stderr events", async () => {
      const stderrPromise = new Promise<ClierEvent>((resolve) => {
        bus.on("stderr", resolve);
      });

      await processManager.startProcess({
        name: "test-stderr",
        command: "echo error >&2",
        type: "task",
      });

      const event = await stderrPromise;
      expect(event.type).toBe("stderr");
      expect(event.processName).toBe("test-stderr");
      expect(event.data).toBe("error");
    });

    it("should normalize process:exit events with complete logs", async () => {
      const exitPromise = new Promise<ClierEvent>((resolve) => {
        bus.on("process:exit", resolve);
      });

      await processManager.startProcess({
        name: "test-exit",
        command: "echo line1 && echo line2",
        type: "task",
      });

      const event = await exitPromise;
      expect(event.name).toBe("process:exit");
      expect(event.processName).toBe("test-exit");
      expect(event.type).toBe("custom");
      expect(event.data).toHaveProperty("code", 0);
      expect(event.data).toHaveProperty("stdout");
      expect((event.data as any).stdout).toContain("line1");
      expect((event.data as any).stdout).toContain("line2");
    });

    it("should normalize process:start events", async () => {
      const startPromise = new Promise<ClierEvent>((resolve) => {
        bus.on("process:start", resolve);
      });

      await processManager.startProcess({
        name: "test-start",
        command: "echo hello",
        type: "task",
      });

      const event = await startPromise;
      expect(event.name).toBe("process:start");
      expect(event.processName).toBe("test-start");
      expect(event.type).toBe("custom");
      expect(event.data).toHaveProperty("pid");
      expect((event.data as any).pid).toBeGreaterThan(0);
    });
  });

  describe("on", () => {
    it("should register event handler", () => {
      const handler = vi.fn();

      bus.on("stdout", handler);

      expect(() =>
        bus.emit("stdout", {
          name: "test",
          processName: "test",
          type: "stdout",
          data: "hello",
          timestamp: Date.now(),
        })
      ).not.toThrow();
    });

    it("should allow multiple handlers for same event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.on("stdout", handler1);
      bus.on("stdout", handler2);

      bus.emit("stdout", {
        name: "test",
        processName: "test",
        type: "stdout",
        data: "hello",
        timestamp: Date.now(),
      });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("emit", () => {
    it("should emit events to registered handlers", () => {
      const handler = vi.fn();
      const event: ClierEvent = {
        name: "test:event",
        processName: "test",
        type: "custom",
        timestamp: Date.now(),
      };

      bus.on("test:event", handler);
      bus.emit("test:event", event);

      expect(handler).toHaveBeenCalledWith(event);
    });

    it("should handle events with no handlers", () => {
      const event: ClierEvent = {
        name: "test:event",
        processName: "test",
        type: "custom",
        timestamp: Date.now(),
      };

      expect(() => bus.emit("test:event", event)).not.toThrow();
    });

    it("should call all handlers for an event", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();
      const event: ClierEvent = {
        name: "test:event",
        processName: "test",
        type: "custom",
        timestamp: Date.now(),
      };

      bus.on("test:event", handler1);
      bus.on("test:event", handler2);
      bus.on("test:event", handler3);

      bus.emit("test:event", event);

      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
      expect(handler3).toHaveBeenCalledWith(event);
    });
  });

  describe("removeAllListeners", () => {
    it("should remove all event listeners", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.on("event1", handler1);
      bus.on("event2", handler2);

      bus.removeAllListeners();

      bus.emit("event1", {
        name: "event1",
        processName: "test",
        type: "custom",
        timestamp: Date.now(),
      });
      bus.emit("event2", {
        name: "event2",
        processName: "test",
        type: "custom",
        timestamp: Date.now(),
      });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});
