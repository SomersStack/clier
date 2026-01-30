import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventHandler } from "../../../src/core/event-handler.js";
import { PatternMatcher } from "../../../src/core/pattern-matcher.js";
import type { PipelineItem } from "../../../src/config/types.js";
import type { ClierEvent } from "../../../src/types/events.js";

describe("EventHandler", () => {
  let handler: EventHandler;
  let patternMatcher: PatternMatcher;

  const createPipelineItem = (
    overrides?: Partial<PipelineItem>,
  ): PipelineItem => ({
    name: "test-process",
    command: "npm test",
    type: "task",
    events: {
      on_stdout: [],
      on_stderr: true,
      on_crash: true,
    },
    ...overrides,
  });

  beforeEach(() => {
    patternMatcher = new PatternMatcher();
    handler = new EventHandler(patternMatcher);
  });

  describe("registerPipelineItem", () => {
    it("should register pipeline item with patterns", () => {
      const item = createPipelineItem({
        events: {
          on_stdout: [
            { pattern: "Server listening", emit: "backend:ready" },
            { pattern: "Database connected", emit: "backend:db-connected" },
          ],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      // Pattern matcher should have patterns registered
      expect(patternMatcher.getPatternCount()).toBe(2);
    });

    it("should register pipeline item without patterns", () => {
      const item = createPipelineItem({
        events: {
          on_stdout: [],
          on_stderr: false,
          on_crash: false,
        },
      });

      expect(() => handler.registerPipelineItem(item)).not.toThrow();
    });

    it("should compile regex patterns from strings", () => {
      const item = createPipelineItem({
        events: {
          on_stdout: [{ pattern: "Server.*ready", emit: "backend:ready" }],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      // Should be able to match regex pattern
      const matches = patternMatcher.match("Server is ready");
      expect(matches).toContain("backend:ready");
    });
  });

  describe("handleEvent - stdout pattern matching", () => {
    it("should emit custom events for matching stdout patterns", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [{ pattern: "Server listening", emit: "backend:ready" }],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:ready", (event) => emittedEvents.push(event));

      const stdoutEvent: ClierEvent = {
        name: "backend",
        processName: "backend",
        type: "stdout",
        data: "Server listening on port 3000",
        timestamp: Date.now(),
      };

      handler.handleEvent(stdoutEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe("backend:ready");
      expect(emittedEvents[0].processName).toBe("backend");
      expect(emittedEvents[0].type).toBe("custom");
    });

    it("should emit ALL matching events when multiple patterns match", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [
            { pattern: "Server", emit: "backend:server" },
            { pattern: "listening", emit: "backend:listening" },
            { pattern: "port", emit: "backend:port" },
          ],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: string[] = [];
      handler.on("backend:server", () => emittedEvents.push("backend:server"));
      handler.on("backend:listening", () =>
        emittedEvents.push("backend:listening"),
      );
      handler.on("backend:port", () => emittedEvents.push("backend:port"));

      const stdoutEvent: ClierEvent = {
        name: "backend",
        processName: "backend",
        type: "stdout",
        data: "Server listening on port 3000",
        timestamp: Date.now(),
      };

      handler.handleEvent(stdoutEvent);

      expect(emittedEvents).toContain("backend:server");
      expect(emittedEvents).toContain("backend:listening");
      expect(emittedEvents).toContain("backend:port");
      expect(emittedEvents).toHaveLength(3);
    });

    it("should not emit events for non-matching patterns", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [
            { pattern: "Database connected", emit: "backend:db-connected" },
          ],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:db-connected", (event) => emittedEvents.push(event));

      const stdoutEvent: ClierEvent = {
        name: "backend",
        processName: "backend",
        type: "stdout",
        data: "Server listening on port 3000",
        timestamp: Date.now(),
      };

      handler.handleEvent(stdoutEvent);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("handleEvent - task success (exit code 0)", () => {
    it("should emit {name}:success for task with exit code 0", () => {
      const item = createPipelineItem({
        name: "build",
        type: "task",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("build:success", (event) => emittedEvents.push(event));

      const exitEvent: ClierEvent = {
        name: "process:exit",
        processName: "build",
        type: "custom",
        data: 0, // exit code 0
        timestamp: Date.now(),
      };

      handler.handleEvent(exitEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe("build:success");
      expect(emittedEvents[0].type).toBe("success");
      expect(emittedEvents[0].data).toBe(0);
    });

    it("should not emit success for non-zero exit code", () => {
      const item = createPipelineItem({
        name: "build",
        type: "task",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("build:success", (event) => emittedEvents.push(event));

      const exitEvent: ClierEvent = {
        name: "process:exit",
        processName: "build",
        type: "custom",
        data: 1, // exit code 1
        timestamp: Date.now(),
      };

      handler.handleEvent(exitEvent);

      expect(emittedEvents).toHaveLength(0);
    });

    it("should emit success for services with on-failure restart (default)", () => {
      const item = createPipelineItem({
        name: "backend",
        type: "service",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:success", (event) => emittedEvents.push(event));

      const exitEvent: ClierEvent = {
        name: "process:exit",
        processName: "backend",
        type: "custom",
        data: 0,
        timestamp: Date.now(),
      };

      handler.handleEvent(exitEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe("backend:success");
    });

    it("should not emit success for services with restart always", () => {
      const item = createPipelineItem({
        name: "backend",
        type: "service",
        restart: "always",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:success", (event) => emittedEvents.push(event));

      const exitEvent: ClierEvent = {
        name: "process:exit",
        processName: "backend",
        type: "custom",
        data: 0,
        timestamp: Date.now(),
      };

      handler.handleEvent(exitEvent);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("handleEvent - stderr", () => {
    it("should emit {name}:error on stderr when on_stderr is true", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:error", (event) => emittedEvents.push(event));

      const stderrEvent: ClierEvent = {
        name: "backend",
        processName: "backend",
        type: "stderr",
        data: "Error: Connection refused",
        timestamp: Date.now(),
      };

      handler.handleEvent(stderrEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe("backend:error");
      expect(emittedEvents[0].type).toBe("error");
      expect(emittedEvents[0].data).toBe("Error: Connection refused");
    });

    it("should not emit error on stderr when on_stderr is false", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [],
          on_stderr: false,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:error", (event) => emittedEvents.push(event));

      const stderrEvent: ClierEvent = {
        name: "backend",
        processName: "backend",
        type: "stderr",
        data: "Error: Connection refused",
        timestamp: Date.now(),
      };

      handler.handleEvent(stderrEvent);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("handleEvent - crash", () => {
    it("should emit {name}:crashed on process crash when on_crash is true", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:crashed", (event) => emittedEvents.push(event));

      // Exit code other than 0 for service indicates crash
      const exitEvent: ClierEvent = {
        name: "process:exit",
        processName: "backend",
        type: "custom",
        data: 1, // non-zero exit code
        timestamp: Date.now(),
      };

      handler.handleEvent(exitEvent);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].name).toBe("backend:crashed");
      expect(emittedEvents[0].type).toBe("crashed");
    });

    it("should not emit crashed when on_crash is false", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [],
          on_stderr: true,
          on_crash: false,
        },
      });

      handler.registerPipelineItem(item);

      const emittedEvents: ClierEvent[] = [];
      handler.on("backend:crashed", (event) => emittedEvents.push(event));

      const exitEvent: ClierEvent = {
        name: "process:exit",
        processName: "backend",
        type: "custom",
        data: 1,
        timestamp: Date.now(),
      };

      handler.handleEvent(exitEvent);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe("getEventHistory", () => {
    it("should track event history", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [{ pattern: "ready", emit: "backend:ready" }],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      const stdoutEvent: ClierEvent = {
        name: "backend",
        processName: "backend",
        type: "stdout",
        data: "Server is ready",
        timestamp: Date.now(),
      };

      handler.handleEvent(stdoutEvent);

      const history = handler.getEventHistory();
      expect(history.length).toBeGreaterThan(0);
    });

    it("should limit event history size", () => {
      const item = createPipelineItem({
        name: "backend",
        events: {
          on_stdout: [{ pattern: ".*", emit: "backend:log" }],
          on_stderr: true,
          on_crash: true,
        },
      });

      handler.registerPipelineItem(item);

      // Emit many events
      for (let i = 0; i < 150; i++) {
        const event: ClierEvent = {
          name: "backend",
          processName: "backend",
          type: "stdout",
          data: `Log line ${i}`,
          timestamp: Date.now(),
        };
        handler.handleEvent(event);
      }

      const history = handler.getEventHistory();
      // Should be limited to 100 events
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe("on/emit", () => {
    it("should allow subscribing to events", () => {
      const callback = vi.fn();

      handler.on("test:event", callback);
      handler.emit("test:event", {
        name: "test:event",
        processName: "test",
        type: "custom",
        timestamp: Date.now(),
      });

      expect(callback).toHaveBeenCalled();
    });
  });
});
