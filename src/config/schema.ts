import { z } from "zod";

/**
 * Schema for stdout event pattern matching
 */
const stdoutEventSchema = z.object({
  pattern: z
    .string()
    .min(
      1,
      "Pattern must not be empty - provide a regex pattern to match stdout",
    ),
  emit: z
    .string()
    .min(
      1,
      "Event name must not be empty - provide the name of the event to emit",
    ),
});

/**
 * Schema for event configuration
 */
const eventsSchema = z.object({
  on_stdout: z.array(stdoutEventSchema),
  on_stderr: z.boolean().default(true),
  on_crash: z.boolean().default(true),
});

/**
 * Schema for input configuration
 */
const inputConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .optional();

/**
 * Schema for pipeline item configuration
 */
const pipelineItemSchema = z.object({
  name: z
    .string()
    .min(1, "Pipeline name must not be empty - provide a unique identifier"),
  command: z
    .string()
    .min(1, "Command must not be empty - provide the shell command to execute"),
  type: z.enum(["service", "task"], {
    errorMap: () => ({ message: "Expected 'service', 'task', or 'stage'" }),
  }),
  trigger_on: z.array(z.string()).optional(),
  continue_on_failure: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  events: eventsSchema.optional(),
  enable_event_templates: z.boolean().optional().default(false),
  /** If true, this stage only starts via 'clier trigger' command (not auto-started or event-triggered) */
  manual: z.boolean().optional(),
  /** Input configuration for stdin support */
  input: inputConfigSchema,
  /** Restart policy: "always", "on-failure" (default for services), or "never" */
  restart: z.enum(["always", "on-failure", "never"]).optional(),
});

/**
 * Schema for stage configuration (groups pipeline items)
 *
 * Stages allow grouping related pipeline items together with shared properties.
 * When flattened, stage properties like `manual` and `trigger_on` propagate to steps.
 */
const stageSchema = z.object({
  name: z
    .string()
    .min(1, "Stage name must not be empty - provide a unique identifier"),
  type: z.literal("stage"),
  /** If true, all steps in this stage require manual start */
  manual: z.boolean().optional(),
  /** Event triggers that propagate to non-manual steps */
  trigger_on: z.array(z.string()).optional(),
  /** Steps within this stage - at least one required */
  steps: z
    .array(pipelineItemSchema)
    .min(1, "Stage must have at least one step"),
});

/**
 * Schema for a pipeline entry (either a step or a stage)
 * Uses discriminatedUnion on "type" field for better error messages
 */
const pipelineEntrySchema = z.discriminatedUnion("type", [
  pipelineItemSchema,
  stageSchema,
]);

/**
 * Schema for circuit breaker configuration
 */
const circuitBreakerSchema = z.object({
  /** Whether the circuit breaker is enabled (default: true) */
  enabled: z.boolean().default(true),
  /** Error threshold count before opening circuit (default: 10) */
  error_threshold: z
    .number()
    .int()
    .positive("error_threshold must be positive")
    .default(10),
  /** Timeout in milliseconds for protected operations (default: 30000) */
  timeout_ms: z
    .number()
    .int()
    .positive("timeout_ms must be positive")
    .default(30000),
  /** Time in milliseconds before attempting to close an open circuit (default: 60000) */
  reset_timeout_ms: z
    .number()
    .int()
    .positive("reset_timeout_ms must be positive")
    .default(60000),
});

/**
 * Schema for safety configuration
 */
const safetySchema = z.object({
  max_ops_per_minute: z
    .number()
    .int()
    .positive("max_ops_per_minute must be positive"),
  debounce_ms: z.number().int().nonnegative("debounce_ms must be non-negative"),
  /** Circuit breaker configuration (optional) */
  circuit_breaker: circuitBreakerSchema.optional(),
});

/**
 * Main configuration schema for clier-pipeline.json
 *
 * Validates the complete configuration structure including:
 * - Project metadata
 * - Global environment settings
 * - Safety limits for rate limiting and debouncing
 * - Pipeline items array with services and tasks
 *
 * @example
 * ```ts
 * const config = {
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
 *       env: { PORT: '${PORT}' },
 *       events: {
 *         on_stdout: [{ pattern: 'listening', emit: 'backend:ready' }]
 *       }
 *     }
 *   ]
 * };
 *
 * const validated = configSchema.parse(config);
 * ```
 */
export const configSchema = z
  .object({
    project_name: z
      .string()
      .min(
        1,
        "Project name must not be empty - provide a descriptive name for your project",
      ),
    global_env: z.boolean().default(true),
    safety: safetySchema,
    pipeline: z
      .array(pipelineEntrySchema)
      .min(1, "Pipeline must contain at least one item"),
  })
  .strict()
  .refine(
    (config) => {
      // Collect all names: top-level entries + steps inside stages
      const names: string[] = [];
      for (const entry of config.pipeline) {
        names.push(entry.name);
        if (entry.type === "stage") {
          for (const step of entry.steps) {
            names.push(step.name);
          }
        }
      }
      const uniqueNames = new Set(names);
      return names.length === uniqueNames.size;
    },
    {
      message: "Pipeline items must have unique names - found duplicate names",
    },
  );

/**
 * Type alias for the Zod stdout event schema
 */
export type StdoutEventSchema = typeof stdoutEventSchema;

/**
 * Type alias for the Zod events schema
 */
export type EventsSchema = typeof eventsSchema;

/**
 * Type alias for the Zod input config schema
 */
export type InputConfigSchema = typeof inputConfigSchema;

/**
 * Type alias for the Zod pipeline item schema
 */
export type PipelineItemSchema = typeof pipelineItemSchema;

/**
 * Type alias for the Zod safety schema
 */
export type SafetySchema = typeof safetySchema;

/**
 * Type alias for the Zod stage schema
 */
export type StageSchema = typeof stageSchema;

/**
 * Type alias for the Zod pipeline entry schema
 */
export type PipelineEntrySchema = typeof pipelineEntrySchema;

/**
 * Type alias for the main config schema
 */
export type ConfigSchema = typeof configSchema;
