/**
 * Template Schemas
 *
 * Zod validation schemas for pipeline stage templates.
 */

import { z } from "zod";

/**
 * Schema for script definition
 */
export const scriptDefinitionSchema = z
  .object({
    path: z.string().min(1, "Script path must not be empty"),
    bundledScript: z.string().optional(),
    content: z.string().optional(),
    executable: z.boolean().optional(),
    description: z.string().optional(),
  })
  .refine((script) => script.bundledScript || script.content, {
    message: "Script must have either bundledScript or content",
  });

/**
 * Schema for variable definition
 */
export const variableDefinitionSchema = z.object({
  name: z.string().min(1, "Variable name must not be empty"),
  label: z.string().min(1, "Variable label must not be empty"),
  default: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

/**
 * Schema for stdout event in stage template
 */
const stdoutEventSchema = z.object({
  pattern: z.string().min(1, "Pattern must not be empty"),
  emit: z.string().min(1, "Event name must not be empty"),
});

/**
 * Schema for events configuration in stage template
 */
const eventsSchema = z.object({
  on_stdout: z.array(stdoutEventSchema),
  on_stderr: z.boolean().default(true),
  on_crash: z.boolean().default(true),
});

/**
 * Schema for the stage configuration within a template
 */
const stageConfigSchema = z.object({
  name: z.string().min(1, "Stage name must not be empty"),
  command: z.string().min(1, "Command must not be empty"),
  type: z.enum(["service", "task"]),
  trigger_on: z.array(z.string()).optional(),
  continue_on_failure: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  events: eventsSchema.optional(),
  enable_event_templates: z.boolean().optional(),
  manual: z.boolean().optional(),
});

/**
 * Schema for stage template
 */
export const stageTemplateSchema = z.object({
  id: z.string().min(1, "Template ID must not be empty"),
  name: z.string().min(1, "Template name must not be empty"),
  description: z.string().min(1, "Template description must not be empty"),
  category: z.enum(["service", "task", "utility"]),
  tags: z.array(z.string()).optional(),
  stage: stageConfigSchema,
  variables: z.array(variableDefinitionSchema).optional(),
  scripts: z.array(scriptDefinitionSchema).optional(),
});

/**
 * Schema for template manifest (index.json)
 */
export const templateManifestSchema = z.object({
  templates: z.array(z.string()),
});

/**
 * Type aliases for inferred types
 */
export type StageTemplateSchema = typeof stageTemplateSchema;
export type VariableDefinitionSchema = typeof variableDefinitionSchema;
export type ScriptDefinitionSchema = typeof scriptDefinitionSchema;
export type TemplateManifestSchema = typeof templateManifestSchema;
