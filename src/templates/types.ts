/**
 * Template Types
 *
 * TypeScript interfaces for pipeline stage templates.
 */

import type { PipelineItem } from "../config/types.js";

/**
 * Definition for a script bundled with a template
 */
export interface ScriptDefinition {
  /** Relative path where script should be created (e.g., "scripts/build.sh") */
  path: string;
  /** Reference to bundled script file in templates/stages/scripts/ */
  bundledScript?: string;
  /** Inline script content (alternative to bundledScript) */
  content?: string;
  /** Whether to make the script executable (chmod +x) */
  executable?: boolean;
  /** Description of what the script does */
  description?: string;
}

/**
 * Definition for a customizable variable in a template
 */
export interface VariableDefinition {
  /** Variable name (used in template as {{name}}) */
  name: string;
  /** Human-readable label for display */
  label: string;
  /** Default value if not provided */
  default?: string;
  /** Description/help text */
  description?: string;
  /** Whether this variable must be provided */
  required?: boolean;
}

/**
 * Stage template definition
 *
 * Defines a reusable pipeline stage template with customizable variables
 * and optional bundled scripts.
 */
export interface StageTemplate {
  /** Unique template identifier (e.g., "node-api") */
  id: string;
  /** Human-readable template name */
  name: string;
  /** Brief description of what this template creates */
  description: string;
  /** Template category for grouping */
  category: "service" | "task" | "utility";
  /** Optional tags for filtering */
  tags?: string[];
  /** The pipeline stage configuration (with {{variable}} placeholders) */
  stage: Partial<PipelineItem> & { name: string; command: string; type: "service" | "task" };
  /** Customizable variables */
  variables?: VariableDefinition[];
  /** Scripts to create when applying the template */
  scripts?: ScriptDefinition[];
}

/**
 * Template manifest (index.json)
 *
 * Lists all available templates with basic metadata.
 */
export interface TemplateManifest {
  /** List of template IDs */
  templates: string[];
}

/**
 * Options for listing templates
 */
export interface ListTemplatesOptions {
  /** Filter by category */
  category?: "service" | "task" | "utility";
}

/**
 * Options for applying a template
 */
export interface ApplyTemplateOptions {
  /** Custom stage name (overrides default) */
  name?: string;
  /** Variable values (key=value pairs) */
  variables?: Record<string, string>;
  /** Add directly to clier-pipeline.json */
  add?: boolean;
  /** Output to specific file */
  output?: string;
  /** Overwrite existing files without prompting */
  force?: boolean;
}

/**
 * Result of applying a template
 */
export interface ApplyTemplateResult {
  /** The generated pipeline stage configuration */
  stage: PipelineItem;
  /** Scripts that were created */
  scriptsCreated: string[];
  /** Scripts that were skipped (already exist) */
  scriptsSkipped: string[];
}
