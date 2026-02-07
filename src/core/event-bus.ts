/**
 * Event Bus
 *
 * Receives events from ProcessManager and distributes them as normalized ClierEvents.
 * No PM2 dependency - connects directly to the ProcessManager's event emitter.
 */

import EventEmitter from "events";
import type { ClierEvent, EventHandlerFn } from "../types/events.js";
import type { ProcessManager, ExitLogs } from "./process-manager.js";
import { createContextLogger } from "../utils/logger.js";

const logger = createContextLogger("EventBus");

/**
 * EventBus class
 *
 * Connects to ProcessManager and normalizes events to ClierEvent format.
 * Much simpler than the PM2-based implementation - no daemon, no reconnection needed.
 *
 * @example
 * ```ts
 * const processManager = new ProcessManager();
 * const bus = new EventBus(processManager);
 * await bus.connect();
 *
 * bus.on('stdout', (event) => {
 *   console.log(`[${event.processName}] ${event.data}`);
 * });
 *
 * bus.on('stderr', (event) => {
 *   console.error(`[${event.processName}] ${event.data}`);
 * });
 *
 * await bus.disconnect();
 * ```
 */
export class EventBus {
  private processManager: ProcessManager;
  private connected = false;
  private emitter = new EventEmitter();
  private pmListeners: Array<{
    event: string;
    handler: (...args: any[]) => void;
  }> = [];

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
  }

  /**
   * Connect to the ProcessManager and setup event listeners
   *
   * @example
   * ```ts
   * await bus.connect();
   * ```
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.debug("Already connected to event bus");
      return;
    }

    this.setupEventListeners();
    this.connected = true;
    logger.info("Event bus connected");
  }

  /**
   * Disconnect from the event bus
   *
   * @example
   * ```ts
   * await bus.disconnect();
   * ```
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.emitter.removeAllListeners();
    for (const { event, handler } of this.pmListeners) {
      this.processManager.removeListener(event, handler);
    }
    this.pmListeners = [];
    this.connected = false;
    logger.info("Event bus disconnected");
  }

  /**
   * Subscribe to normalized events
   *
   * Event types:
   * - 'stdout': Process stdout output
   * - 'stderr': Process stderr output
   * - 'process:exit': Process exited (includes complete logs)
   * - 'process:start': Process started
   *
   * @param event - Event name
   * @param handler - Event handler function
   *
   * @example
   * ```ts
   * bus.on('stdout', (event) => {
   *   console.log(event.data);
   * });
   * ```
   */
  on(event: string, handler: EventHandlerFn): void {
    this.emitter.on(event, handler);
  }

  /**
   * Emit a normalized event
   *
   * @param event - Event name
   * @param data - Event data
   *
   * @example
   * ```ts
   * bus.emit('custom:event', {
   *   name: 'custom:event',
   *   processName: 'backend',
   *   type: 'custom',
   *   timestamp: Date.now()
   * });
   * ```
   */
  emit(event: string, data: ClierEvent): void {
    try {
      this.emitter.emit(event, data);
      logger.debug("Event emitted", { event, processName: data.processName });
    } catch (error) {
      logger.error("Error emitting event", {
        event,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Remove all event listeners
   *
   * @example
   * ```ts
   * bus.removeAllListeners();
   * ```
   */
  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  /**
   * Setup event listeners on ProcessManager
   */
  private setupEventListeners(): void {
    const track = (event: string, handler: (...args: any[]) => void) => {
      this.processManager.on(event, handler);
      this.pmListeners.push({ event, handler });
    };

    // Handle stdout
    track("stdout", (name: string, data: string, timestamp: number) => {
      const event = this.normalizeLogEvent(name, "stdout", data, timestamp);
      this.emit("stdout", event);
    });

    // Handle stderr
    track("stderr", (name: string, data: string, timestamp: number) => {
      const event = this.normalizeLogEvent(name, "stderr", data, timestamp);
      this.emit("stderr", event);
    });

    // Handle process exit - now guaranteed to have complete logs
    track(
      "exit",
      (
        name: string,
        code: number | null,
        signal: string | null,
        logs: ExitLogs,
      ) => {
        const event: ClierEvent = {
          name: "process:exit",
          processName: name,
          type: "custom",
          data: {
            code,
            signal,
            // Include complete stdout/stderr captured before exit
            stdout: logs.stdout,
            stderr: logs.stderr,
          },
          timestamp: Date.now(),
        };
        this.emit("process:exit", event);
      },
    );

    // Handle process start
    track("start", (name: string, pid: number) => {
      const event: ClierEvent = {
        name: "process:start",
        processName: name,
        type: "custom",
        data: { pid },
        timestamp: Date.now(),
      };
      this.emit("process:start", event);
    });

    // Handle process restart
    track("restart", (name: string, attempt: number) => {
      const event: ClierEvent = {
        name: "process:restart",
        processName: name,
        type: "custom",
        data: { attempt },
        timestamp: Date.now(),
      };
      this.emit("process:restart", event);
    });

    // Handle errors
    track("error", (name: string, error: Error) => {
      const event: ClierEvent = {
        name: "process:error",
        processName: name,
        type: "error",
        data: { message: error.message },
        timestamp: Date.now(),
      };
      this.emit("process:error", event);
    });

    logger.debug("Event listeners configured");
  }

  /**
   * Normalize a log event to ClierEvent format
   */
  private normalizeLogEvent(
    processName: string,
    type: "stdout" | "stderr",
    data: string,
    timestamp: number,
  ): ClierEvent {
    return {
      name: processName,
      processName,
      type,
      data,
      timestamp,
    };
  }
}
