/**
 * Event Template Substitution Utility
 *
 * Provides safe, formulaic template variable substitution for event-triggered processes.
 * Only predefined metadata variables are supported - no arbitrary code execution or
 * user-controlled data injection.
 *
 * Supported template variables:
 * - {{event.name}}        - Event name (e.g., "backend:ready")
 * - {{event.type}}        - Event type (custom, success, error, crashed, stdout, stderr)
 * - {{event.timestamp}}   - Unix timestamp in milliseconds
 * - {{event.source}}      - Process name that emitted the event
 * - {{process.name}}      - Current process name
 * - {{process.type}}      - Process type (service/task)
 * - {{clier.project}}     - Project name from config
 * - {{clier.timestamp}}   - Current timestamp
 *
 * @example
 * ```ts
 * const context: TemplateContext = {
 *   event: {
 *     name: 'backend:ready',
 *     type: 'custom',
 *     timestamp: 1706012345678,
 *     source: 'backend'
 *   },
 *   process: {
 *     name: 'frontend',
 *     type: 'service'
 *   },
 *   clier: {
 *     project: 'my-app'
 *   }
 * };
 *
 * const result = substituteEventTemplates(
 *   'node app.js --triggered-by={{event.source}}',
 *   context
 * );
 * // Result: "node app.js --triggered-by=backend"
 * ```
 */

import type { ClierEvent } from "../types/events.js";
import { createContextLogger } from "./logger.js";

const logger = createContextLogger("TemplateEngine");

/**
 * Template context containing all available variables
 */
export interface TemplateContext {
  /** Event metadata (required when applying templates) */
  event?: {
    name: string;
    type: string;
    timestamp: number;
    source: string;
  };
  /** Process metadata */
  process: {
    name: string;
    type: "service" | "task";
  };
  /** Clier system metadata */
  clier: {
    project: string;
  };
}

/**
 * Template validation result
 */
export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  usedVariables: string[];
}

/**
 * Create template context from event and process info
 *
 * @param event - ClierEvent that triggered the process
 * @param processName - Name of the process being started
 * @param processType - Type of the process (service/task)
 * @param projectName - Project name from config
 * @returns Template context object
 */
export function createTemplateContext(
  event: ClierEvent,
  processName: string,
  processType: "service" | "task",
  projectName: string,
): TemplateContext {
  return {
    event: {
      name: event.name,
      type: event.type,
      timestamp: event.timestamp,
      source: event.processName,
    },
    process: {
      name: processName,
      type: processType,
    },
    clier: {
      project: projectName,
    },
  };
}

/**
 * Substitute template variables in a string
 *
 * Replaces all template variables ({{variable.path}}) with their corresponding
 * values from the context. Unknown variables are left unchanged and logged as warnings.
 *
 * @param template - String containing template variables
 * @param context - Template context with variable values
 * @returns String with templates substituted
 *
 * @example
 * ```ts
 * substituteEventTemplates(
 *   'cmd --event={{event.name}} --source={{event.source}}',
 *   context
 * );
 * ```
 */
export function substituteEventTemplates(
  template: string,
  context: TemplateContext,
): string {
  if (!template) {
    return template;
  }

  // If no event context, can't substitute event.* variables
  // This happens for entry point processes (no trigger event)
  if (!context.event) {
    logger.debug("No event context - skipping event template substitution");
    return template;
  }

  let result = template;

  // Current timestamp for {{clier.timestamp}}
  const now = Date.now();

  // Event variables
  result = result.replace(/\{\{event\.name\}\}/g, context.event.name);
  result = result.replace(/\{\{event\.type\}\}/g, context.event.type);
  result = result.replace(
    /\{\{event\.timestamp\}\}/g,
    String(context.event.timestamp),
  );
  result = result.replace(/\{\{event\.source\}\}/g, context.event.source);

  // Process variables
  result = result.replace(/\{\{process\.name\}\}/g, context.process.name);
  result = result.replace(/\{\{process\.type\}\}/g, context.process.type);

  // Clier variables
  result = result.replace(/\{\{clier\.project\}\}/g, context.clier.project);
  result = result.replace(/\{\{clier\.timestamp\}\}/g, String(now));

  // Check for unsubstituted templates (unknown variables)
  const unsubstituted = result.match(/\{\{[^}]+\}\}/g);
  if (unsubstituted && unsubstituted.length > 0) {
    logger.warn("Unknown template variables found", {
      variables: unsubstituted,
      originalTemplate: template,
    });
  }

  return result;
}

/**
 * Validate a template string for syntax errors
 *
 * Checks for:
 * - Unclosed template tags
 * - Unknown template variables
 * - Malformed template syntax
 *
 * @param template - Template string to validate
 * @param requiresEvent - Whether the template requires event context (default: true)
 * @returns Validation result with errors, warnings, and used variables
 *
 * @example
 * ```ts
 * const result = validateTemplateString('cmd --source={{event.source}}');
 * if (!result.valid) {
 *   console.error('Template errors:', result.errors);
 * }
 * ```
 */
export function validateTemplateString(
  template: string,
  requiresEvent = true,
): TemplateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const usedVariables: string[] = [];

  if (!template) {
    return { valid: true, errors, warnings, usedVariables };
  }

  // Check for unclosed templates
  const openCount = (template.match(/\{\{/g) || []).length;
  const closeCount = (template.match(/\}\}/g) || []).length;

  if (openCount !== closeCount) {
    errors.push(
      `Mismatched template brackets: ${openCount} opening {{ but ${closeCount} closing }}`,
    );
    return { valid: false, errors, warnings, usedVariables };
  }

  // Extract all template variables
  const templateMatches = template.match(/\{\{([^}]+)\}\}/g);

  if (!templateMatches) {
    // No templates found - valid but note if event context is required
    if (requiresEvent) {
      warnings.push(
        "No template variables found but enable_event_templates is true",
      );
    }
    return { valid: true, errors, warnings, usedVariables };
  }

  // Known template variables
  const knownVariables = new Set([
    "event.name",
    "event.type",
    "event.timestamp",
    "event.source",
    "process.name",
    "process.type",
    "clier.project",
    "clier.timestamp",
  ]);

  const eventVariables = new Set([
    "event.name",
    "event.type",
    "event.timestamp",
    "event.source",
  ]);

  for (const match of templateMatches) {
    // Extract variable name (remove {{ and }})
    const varName = match.slice(2, -2).trim();
    usedVariables.push(varName);

    // Check if known variable
    if (!knownVariables.has(varName)) {
      warnings.push(`Unknown template variable: {{${varName}}}`);
    }

    // Check if event variable is used when event context might not be available
    if (eventVariables.has(varName) && !requiresEvent) {
      warnings.push(
        `Event variable {{${varName}}} used but process may not have event context`,
      );
    }
  }

  // Valid if no errors (warnings are non-fatal)
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    usedVariables,
  };
}

/**
 * Get list of all available template variables
 *
 * @returns Array of variable names with descriptions
 */
export function getAvailableVariables(): Array<{
  name: string;
  description: string;
  example: string;
}> {
  return [
    {
      name: "{{event.name}}",
      description: "Event name that triggered this process",
      example: "backend:ready",
    },
    {
      name: "{{event.type}}",
      description: "Event type classification",
      example: "custom",
    },
    {
      name: "{{event.timestamp}}",
      description: "Event timestamp in milliseconds",
      example: "1706012345678",
    },
    {
      name: "{{event.source}}",
      description: "Process name that emitted the event",
      example: "backend",
    },
    {
      name: "{{process.name}}",
      description: "Current process name",
      example: "frontend",
    },
    {
      name: "{{process.type}}",
      description: "Process type (service or task)",
      example: "service",
    },
    {
      name: "{{clier.project}}",
      description: "Project name from configuration",
      example: "my-app",
    },
    {
      name: "{{clier.timestamp}}",
      description: "Current timestamp in milliseconds",
      example: "1706012345678",
    },
  ];
}

/**
 * Check if a string contains any template variables
 *
 * @param str - String to check
 * @returns True if string contains {{...}} patterns
 */
export function hasTemplates(str: string): boolean {
  return /\{\{[^}]+\}\}/.test(str);
}
