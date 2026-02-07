/**
 * Event types for the Clier orchestration system
 *
 * This module defines the event structures used throughout the system
 * for process event handling and orchestration.
 */

/**
 * Normalized Clier event structure
 *
 * Internal event format used by EventHandler and Orchestrator
 */
export interface ClierEvent {
  /** Event name (e.g., 'build:success', 'backend:ready') */
  name: string;
  /** Process name that emitted this event */
  processName: string;
  /** Event type classification */
  type: "success" | "error" | "crashed" | "custom" | "stdout" | "stderr";
  /** Event payload data */
  data?: string | number | Record<string, unknown>;
  /** Timestamp of the event */
  timestamp: number;
}

/**
 * Event handler function type
 */
export type EventHandlerFn = (event: ClierEvent) => void | Promise<void>;

/**
 * Event subscriber interface
 */
export interface EventSubscriber {
  /** Event name to subscribe to */
  event: string;
  /** Handler function */
  handler: EventHandlerFn;
}
