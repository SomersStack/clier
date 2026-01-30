/**
 * Event Handler for processing Clier events
 *
 * Handles normalized events from EventBus, applies pattern matching,
 * and emits appropriate events based on pipeline configuration.
 *
 * Event emission rules:
 * - Exit code 0 for tasks → emit `${name}:success`
 * - Pattern match on stdout → emit custom events (ALL matches)
 * - stderr (if on_stderr: true) → emit `${name}:error`
 * - Process crash (if on_crash: true) → emit `${name}:crashed`
 */

import EventEmitter from "events";
import type { ClierEvent, EventHandlerFn } from "../types/events.js";
import type { PipelineItem } from "../config/types.js";
import type { PatternMatcher } from "./pattern-matcher.js";
import { logger } from "../utils/logger.js";

/**
 * Maximum number of events to keep in history
 */
const MAX_EVENT_HISTORY = 100;

/**
 * EventHandler class
 *
 * Processes events from the event bus and triggers actions based on
 * pipeline configuration.
 *
 * @example
 * ```ts
 * const matcher = new PatternMatcher();
 * const handler = new EventHandler(matcher);
 *
 * handler.registerPipelineItem({
 *   name: 'backend',
 *   command: 'npm start',
 *   type: 'service',
 *   events: {
 *     on_stdout: [
 *       { pattern: 'Server listening', emit: 'backend:ready' }
 *     ],
 *     on_stderr: true,
 *     on_crash: true
 *   }
 * });
 *
 * handler.on('backend:ready', (event) => {
 *   console.log('Backend is ready!');
 * });
 * ```
 */
export class EventHandler {
  private emitter = new EventEmitter();
  private patternMatcher: PatternMatcher;
  private pipelineItems = new Map<string, PipelineItem>();
  private eventHistory: ClierEvent[] = [];

  /**
   * Create a new EventHandler
   *
   * @param patternMatcher - PatternMatcher instance for stdout pattern matching
   *
   * @example
   * ```ts
   * const handler = new EventHandler(patternMatcher);
   * ```
   */
  constructor(patternMatcher: PatternMatcher) {
    this.patternMatcher = patternMatcher;
  }

  /**
   * Register a pipeline item with its event patterns
   *
   * @param item - Pipeline item configuration
   *
   * @example
   * ```ts
   * handler.registerPipelineItem({
   *   name: 'backend',
   *   command: 'npm start',
   *   type: 'service',
   *   events: {
   *     on_stdout: [
   *       { pattern: 'listening', emit: 'backend:ready' }
   *     ],
   *     on_stderr: true,
   *     on_crash: true
   *   }
   * });
   * ```
   */
  registerPipelineItem(item: PipelineItem): void {
    this.pipelineItems.set(item.name, item);

    // Register stdout patterns (if events config exists)
    if (item.events?.on_stdout) {
      for (const stdoutEvent of item.events.on_stdout) {
        const pattern = new RegExp(stdoutEvent.pattern);
        this.patternMatcher.addPattern(item.name, pattern, stdoutEvent.emit);
        logger.debug(
          `Registered pattern for ${item.name}: ${stdoutEvent.pattern} -> ${stdoutEvent.emit}`,
        );
      }
    }
  }

  /**
   * Handle an event from the event bus
   *
   * Applies event emission rules based on event type and pipeline configuration.
   *
   * @param event - ClierEvent to handle
   *
   * @example
   * ```ts
   * handler.handleEvent({
   *   name: 'backend',
   *   processName: 'backend',
   *   type: 'stdout',
   *   data: 'Server listening on port 3000',
   *   timestamp: Date.now()
   * });
   * ```
   */
  handleEvent(event: ClierEvent): void {
    // Add to history
    this.addToHistory(event);

    const item = this.pipelineItems.get(event.processName);
    if (!item) {
      // Event from unknown process, ignore
      return;
    }

    // Handle stdout pattern matching
    if (event.type === "stdout" && typeof event.data === "string") {
      this.handleStdout(event, item);
    }

    // Handle stderr (if events config exists)
    if (event.type === "stderr" && item.events?.on_stderr) {
      this.handleStderr(event, item);
    }

    // Handle process exit
    if (event.name === "process:exit") {
      this.handleProcessExit(event, item);
    }
  }

  /**
   * Subscribe to events
   *
   * @param event - Event name to subscribe to
   * @param handler - Event handler function
   *
   * @example
   * ```ts
   * handler.on('backend:ready', (event) => {
   *   console.log('Backend started!');
   * });
   * ```
   */
  on(event: string, handler: EventHandlerFn): void {
    this.emitter.on(event, handler);
  }

  /**
   * Emit an event
   *
   * @param event - Event name
   * @param data - Event data
   *
   * @example
   * ```ts
   * handler.emit('custom:event', {
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
    } catch (error) {
      logger.error(`Error emitting event ${event}:`, error);
    }
  }

  /**
   * Get event history
   *
   * Returns the last N events processed (limited to MAX_EVENT_HISTORY).
   *
   * @returns Array of ClierEvents
   *
   * @example
   * ```ts
   * const history = handler.getEventHistory();
   * console.log(`Processed ${history.length} events`);
   * ```
   */
  getEventHistory(): ClierEvent[] {
    return [...this.eventHistory];
  }

  /**
   * Handle stdout event with pattern matching
   */
  private handleStdout(event: ClierEvent, item: PipelineItem): void {
    const data = event.data as string;
    const matchedEvents = this.patternMatcher.match(data);

    // Emit ALL matching events
    for (const eventName of matchedEvents) {
      const customEvent: ClierEvent = {
        name: eventName,
        processName: item.name,
        type: "custom",
        data: event.data,
        timestamp: event.timestamp,
      };

      logger.debug(`Pattern matched: ${eventName} from ${item.name}`);
      this.emit(eventName, customEvent);
    }
  }

  /**
   * Handle stderr event
   */
  private handleStderr(event: ClierEvent, item: PipelineItem): void {
    const errorEvent: ClierEvent = {
      name: `${item.name}:error`,
      processName: item.name,
      type: "error",
      data: event.data,
      timestamp: event.timestamp,
    };

    logger.debug(`Stderr event: ${item.name}:error`);
    this.emit(`${item.name}:error`, errorEvent);
  }

  /**
   * Handle process exit event
   */
  private handleProcessExit(event: ClierEvent, item: PipelineItem): void {
    // Extract exit code from various PM2 event formats
    let exitCode: number;
    if (typeof event.data === "number") {
      exitCode = event.data;
    } else if (typeof event.data === "object" && event.data !== null && "code" in event.data) {
      const dataWithCode = event.data as { code: unknown };
      exitCode = typeof dataWithCode.code === "number" ? dataWithCode.code : parseInt(String(dataWithCode.code));
    } else {
      const parsed = parseInt(String(event.data));
      exitCode = isNaN(parsed) ? 1 : parsed; // Default to 1 (error) if unparseable
    }

    // For tasks or services with on-failure/never restart: exit code 0 = success
    const restartMode = item.restart ?? (item.type === "service" ? "on-failure" : "never");
    const willRestart = item.type === "service" && restartMode === "always" && exitCode === 0;

    if (exitCode === 0 && !willRestart) {
      const successEvent: ClierEvent = {
        name: `${item.name}:success`,
        processName: item.name,
        type: "success",
        data: exitCode,
        timestamp: event.timestamp,
      };

      logger.info(`${item.type === "task" ? "Task" : "Service"} ${item.name} completed successfully`);
      this.emit(`${item.name}:success`, successEvent);
      return;
    }

    // For services or tasks with non-zero exit: crash (if events config exists)
    if (item.events?.on_crash && exitCode !== 0) {
      const crashEvent: ClierEvent = {
        name: `${item.name}:crashed`,
        processName: item.name,
        type: "crashed",
        data: exitCode,
        timestamp: event.timestamp,
      };

      logger.warn(`Process ${item.name} crashed with exit code ${exitCode}`);
      this.emit(`${item.name}:crashed`, crashEvent);
    }
  }

  /**
   * Add event to history
   */
  private addToHistory(event: ClierEvent): void {
    this.eventHistory.push(event);

    // Limit history size
    if (this.eventHistory.length > MAX_EVENT_HISTORY) {
      this.eventHistory.shift();
    }
  }
}
