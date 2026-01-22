import { z } from "zod";

/**
 * Schema for stdout event pattern matching
 */
const stdoutEventSchema = z.object({
  pattern: z.string().min(1, "Pattern must not be empty"),
  emit: z.string().min(1, "Event name must not be empty"),
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
 * Schema for pipeline item configuration
 */
const pipelineItemSchema = z.object({
  name: z.string().min(1, "Pipeline name must not be empty"),
  command: z.string().min(1, "Command must not be empty"),
  type: z.enum(["service", "task"]),
  trigger_on: z.array(z.string()).optional(),
  continue_on_failure: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  events: eventsSchema,
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
    project_name: z.string().min(1, "Project name must not be empty"),
    global_env: z.boolean().default(true),
    safety: safetySchema,
    pipeline: z.array(pipelineItemSchema),
  })
  .strict()
  .refine(
    (config) => {
      // Check for duplicate pipeline names
      const names = config.pipeline.map((item) => item.name);
      const uniqueNames = new Set(names);
      return names.length === uniqueNames.size;
    },
    {
      message: "Pipeline items must have unique names - duplicate name found",
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
 * Type alias for the Zod pipeline item schema
 */
export type PipelineItemSchema = typeof pipelineItemSchema;

/**
 * Type alias for the Zod safety schema
 */
export type SafetySchema = typeof safetySchema;

/**
 * Type alias for the main config schema
 */
export type ConfigSchema = typeof configSchema;
