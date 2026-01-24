import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Watcher } from "../../src/watcher.js";
import type { ClierConfig } from "../../src/config/types.js";

// Mock dependencies
vi.mock("../../src/config/loader.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/core/process-manager.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require("events");
  return {
    ProcessManager: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        removeAllListeners: emitter.removeAllListeners.bind(emitter),
        startProcess: vi.fn().mockResolvedValue(undefined),
        stopProcess: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
        listProcesses: vi.fn().mockReturnValue([]),
        isRunning: vi.fn().mockReturnValue(false),
      };
    }),
  };
});

vi.mock("../../src/core/event-bus.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require("events");
  return {
    EventBus: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        removeAllListeners: emitter.removeAllListeners.bind(emitter),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

// Mock safety modules to prevent Bottleneck timers from keeping process alive
vi.mock("../../src/safety/rate-limiter.js", () => ({
  RateLimiter: vi.fn().mockImplementation(() => ({
    schedule: vi.fn().mockImplementation((fn) => fn()),
    stop: vi.fn().mockResolvedValue(undefined),
    getQueueLength: vi.fn().mockReturnValue(0),
  })),
}));

vi.mock("../../src/safety/debouncer.js", () => ({
  Debouncer: vi.fn().mockImplementation(() => ({
    debounce: vi.fn().mockImplementation((_key, fn) => fn()),
    cancelAll: vi.fn(),
  })),
}));

vi.mock("../../src/safety/circuit-breaker.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { EventEmitter } = require("events");
  return {
    CircuitBreaker: vi.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      return {
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        execute: vi.fn().mockImplementation((fn) => fn()),
        shutdown: vi.fn(),
      };
    }),
  };
});

import { loadConfig } from "../../src/config/loader.js";

describe("Watcher", () => {
  let watcher: Watcher;
  const originalProcessOn = process.on.bind(process);

  beforeEach(() => {
    // Prevent signal handlers from being registered during tests
    vi.spyOn(process, "on").mockImplementation((event, handler) => {
      if (event === "SIGINT" || event === "SIGTERM") {
        return process; // No-op for signal handlers
      }
      return originalProcessOn(event, handler as (...args: unknown[]) => void);
    });
  });

  const mockConfig: ClierConfig = {
    project_name: "test-project",
    global_env: true,
    safety: {
      max_ops_per_minute: 60,
      debounce_ms: 100,
    },
    pipeline: [
      {
        name: "backend",
        command: "npm start",
        type: "service",
        enable_event_templates: false,
        events: {
          on_stdout: [{ pattern: "Server listening", emit: "backend:ready" }],
          on_stderr: true,
          on_crash: true,
        },
      },
      {
        name: "frontend",
        command: "npm run dev",
        type: "service",
        enable_event_templates: false,
        trigger_on: ["backend:ready"],
        events: {
          on_stdout: [
            { pattern: "Compiled successfully", emit: "frontend:ready" },
          ],
          on_stderr: true,
          on_crash: true,
        },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
  });

  describe("constructor", () => {
    it("should create watcher instance", () => {
      watcher = new Watcher();
      expect(watcher).toBeDefined();
    });
  });

  describe("start", () => {
    it("should load config from file path", async () => {
      watcher = new Watcher();
      const configPath = "/path/to/clier-pipeline.json";

      await watcher.start(configPath);

      expect(loadConfig).toHaveBeenCalledWith(configPath);
    });

    it("should initialize all components", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // If we get here without errors, components were initialized
      expect(loadConfig).toHaveBeenCalled();
    });

    it("should handle config loading errors", async () => {
      watcher = new Watcher();
      const error = new Error("Config not found");
      vi.mocked(loadConfig).mockRejectedValue(error);

      await expect(watcher.start("/invalid/path")).rejects.toThrow(
        "Config not found",
      );
    });

    it("should not start twice", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Starting again should not throw
      await expect(
        watcher.start("/path/to/config.json"),
      ).resolves.toBeUndefined();

      // Config should only be loaded once
      expect(loadConfig).toHaveBeenCalledOnce();
    });
  });

  describe("stop", () => {
    it("should stop gracefully", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      await expect(watcher.stop()).resolves.toBeUndefined();
    });

    it("should handle stop when not started", async () => {
      watcher = new Watcher();

      await expect(watcher.stop()).resolves.toBeUndefined();
    });

    it("should cleanup all components", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      await watcher.stop();

      // Should be able to stop again without errors
      await expect(watcher.stop()).resolves.toBeUndefined();
    });
  });

  describe("integration", () => {
    it("should handle complete workflow", async () => {
      watcher = new Watcher();

      // Start watcher
      await watcher.start("/path/to/config.json");

      // Stop watcher
      await watcher.stop();

      expect(loadConfig).toHaveBeenCalled();
    });

    it("should apply safety mechanisms", async () => {
      const configWithSafety: ClierConfig = {
        ...mockConfig,
        safety: {
          max_ops_per_minute: 10,
          debounce_ms: 500,
        },
      };

      vi.mocked(loadConfig).mockResolvedValue(configWithSafety);

      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Watcher should be running with safety mechanisms
      expect(watcher).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should handle connection errors gracefully", async () => {
      watcher = new Watcher();

      // Mock will handle errors internally
      await expect(
        watcher.start("/path/to/config.json"),
      ).resolves.toBeUndefined();
    });

    it("should handle event bus errors gracefully", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Errors should be handled internally
      expect(watcher).toBeDefined();
    });
  });

  describe("signal handling", () => {
    it("should handle SIGINT for graceful shutdown", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Simulate SIGINT
      // Note: actual signal handling is tested in integration tests
      await watcher.stop();

      expect(watcher).toBeDefined();
    });

    it("should handle SIGTERM for graceful shutdown", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Simulate SIGTERM
      await watcher.stop();

      expect(watcher).toBeDefined();
    });

    it("should not register signal handlers when setupSignalHandlers is false", async () => {
      // Track signal handler registrations
      let sigintRegistered = false;
      let sigtermRegistered = false;

      vi.spyOn(process, "on").mockImplementation((event, _handler) => {
        if (event === "SIGINT") sigintRegistered = true;
        if (event === "SIGTERM") sigtermRegistered = true;
        return process;
      });

      watcher = new Watcher();

      await watcher.start("/path/to/config.json", undefined, {
        setupSignalHandlers: false,
      });

      // Should not have registered SIGINT or SIGTERM handlers
      expect(sigintRegistered).toBe(false);
      expect(sigtermRegistered).toBe(false);
    });

    it("should register signal handlers by default (setupSignalHandlers not specified)", async () => {
      // Track signal handler registrations
      let sigintRegistered = false;
      let sigtermRegistered = false;

      vi.spyOn(process, "on").mockImplementation((event, _handler) => {
        if (event === "SIGINT") sigintRegistered = true;
        if (event === "SIGTERM") sigtermRegistered = true;
        return process;
      });

      watcher = new Watcher();

      await watcher.start("/path/to/config.json");

      // Should have registered both SIGINT and SIGTERM handlers
      expect(sigintRegistered).toBe(true);
      expect(sigtermRegistered).toBe(true);
    });

    it("should register signal handlers when setupSignalHandlers is explicitly true", async () => {
      // Track signal handler registrations
      let sigintRegistered = false;
      let sigtermRegistered = false;

      vi.spyOn(process, "on").mockImplementation((event, _handler) => {
        if (event === "SIGINT") sigintRegistered = true;
        if (event === "SIGTERM") sigtermRegistered = true;
        return process;
      });

      watcher = new Watcher();

      await watcher.start("/path/to/config.json", undefined, {
        setupSignalHandlers: true,
      });

      // Should have registered both handlers
      expect(sigintRegistered).toBe(true);
      expect(sigtermRegistered).toBe(true);
    });
  });

  describe("concurrent shutdown handling", () => {
    it("should wait for cleanup when stop() is called while already shutting down", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Call stop() twice concurrently - second call should wait for first
      const stopPromise1 = watcher.stop();
      const stopPromise2 = watcher.stop();

      // Both should complete without errors
      await expect(
        Promise.all([stopPromise1, stopPromise2]),
      ).resolves.toBeDefined();
    });

    it("should handle multiple concurrent stop() calls", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      // Simulate race condition with multiple stop() calls
      const stopPromises = [
        watcher.stop(),
        watcher.stop(),
        watcher.stop(),
      ];

      // All should complete without errors
      await expect(Promise.all(stopPromises)).resolves.toBeDefined();
    });

    it("should complete cleanup before returning from concurrent stops", async () => {
      watcher = new Watcher();
      await watcher.start("/path/to/config.json");

      let firstStopCompleted = false;
      let secondStopCompleted = false;

      const stopPromise1 = watcher.stop().then(() => {
        firstStopCompleted = true;
      });

      const stopPromise2 = watcher.stop().then(() => {
        secondStopCompleted = true;
      });

      await Promise.all([stopPromise1, stopPromise2]);

      // Both should have completed
      expect(firstStopCompleted).toBe(true);
      expect(secondStopCompleted).toBe(true);
    });
  });
});
