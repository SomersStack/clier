import { z } from "zod";
import { configSchema } from "./schema.js";

/**
 * TypeScript type for stdout event configuration
 *
 * Defines a pattern-matching rule that emits events when stdout matches a regex pattern.
 */
export type StdoutEvent = {
  /** Regular expression pattern to match against stdout */
  pattern: string;
  /** Event name to emit when pattern matches */
  emit: string;
};

/**
 * TypeScript type for event configuration
 *
 * Defines how a pipeline item emits events based on stdout, stderr, and crashes.
 */
export type Events = {
  /** Array of pattern-matching rules for stdout */
  on_stdout: StdoutEvent[];
  /** Whether to emit ${name}:error event on stderr (default: true) */
  on_stderr: boolean;
  /** Whether to emit ${name}:crashed event on crash (default: true) */
  on_crash: boolean;
};

/**
 * TypeScript type for pipeline item configuration
 *
 * Represents a single service or task in the pipeline.
 */
export type PipelineItem = {
  /** Unique name for this pipeline item */
  name: string;
  /** Shell command to execute */
  command: string;
  /** Type of pipeline item - service (long-running) or task (one-off) */
  type: "service" | "task";
  /** Optional array of event names that trigger this item */
  trigger_on?: string[];
  /** Whether to continue pipeline execution if this item fails (default: undefined) */
  continue_on_failure?: boolean;
  /** Environment variables for this item (supports ${VAR} substitution) */
  env?: Record<string, string>;
  /** Working directory for command execution */
  cwd?: string;
  /** Event configuration for this item (optional - if omitted, no special event emissions occur) */
  events?: Events;
  /** Enable event template variable substitution in command and env (default: false) */
  enable_event_templates?: boolean;
  /** If true, this stage only starts via 'clier trigger' command (not auto-started or event-triggered) */
  manual?: boolean;
  /** Input configuration for stdin support */
  input?: {
    /** Whether stdin input is enabled for this process (default: false) */
    enabled: boolean;
  };
};

/**
 * TypeScript type for circuit breaker configuration
 *
 * Configures the circuit breaker that prevents cascading failures.
 */
export type CircuitBreakerConfig = {
  /** Whether the circuit breaker is enabled (default: true) */
  enabled: boolean;
  /** Error threshold count before opening circuit (default: 10) */
  error_threshold: number;
  /** Timeout in milliseconds for protected operations (default: 30000) */
  timeout_ms: number;
  /** Time in milliseconds before attempting to close an open circuit (default: 60000) */
  reset_timeout_ms: number;
};

/**
 * TypeScript type for safety configuration
 *
 * Defines rate limiting and debouncing parameters to prevent runaway processes.
 */
export type Safety = {
  /** Maximum number of operations (process starts) per minute */
  max_ops_per_minute: number;
  /** Debounce delay in milliseconds before restarting crashed processes */
  debounce_ms: number;
  /** Circuit breaker configuration (optional) */
  circuit_breaker?: CircuitBreakerConfig;
};

/**
 * TypeScript type for the complete Clier configuration
 *
 * This is the main configuration object that defines the entire pipeline.
 * Inferred from the Zod schema to ensure type safety.
 *
 * @example
 * ```ts
 * const config: ClierConfig = {
 *   project_name: 'my-app',
 *   global_env: true,
 *   safety: {
 *     max_ops_per_minute: 60,
 *     debounce_ms: 100
 *   },
 *   pipeline: [
 *     {
 *       name: 'backend',
 *       command: 'npm start',
 *       type: 'service',
 *       env: {
 *         PORT: '${PORT}',
 *         NODE_ENV: 'production'
 *       },
 *       cwd: '/app/backend',
 *       events: {
 *         on_stdout: [
 *           { pattern: 'Server listening', emit: 'backend:ready' }
 *         ],
 *         on_stderr: true,
 *         on_crash: true
 *       }
 *     },
 *     {
 *       name: 'frontend',
 *       command: 'npm run dev',
 *       type: 'service',
 *       trigger_on: ['backend:ready'],
 *       cwd: '/app/frontend',
 *       events: {
 *         on_stdout: [
 *           { pattern: 'ready', emit: 'frontend:ready' }
 *         ],
 *         on_stderr: true,
 *         on_crash: true
 *       }
 *     }
 *   ]
 * };
 * ```
 */
export type ClierConfig = z.infer<typeof configSchema>;
