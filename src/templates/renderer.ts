/**
 * Template Renderer
 *
 * Handles variable substitution in pipeline stage templates.
 */

import type { PipelineItem } from "../config/types.js";
import type { StageTemplate, VariableDefinition } from "./types.js";

/**
 * Substitutes {{variable}} placeholders in a string
 *
 * @param template - String with {{variable}} placeholders
 * @param variables - Variable values to substitute
 * @returns String with variables substituted
 */
export function substituteVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, varName: string) => {
    if (varName in variables) {
      return variables[varName] ?? match;
    }
    return match; // Keep placeholder if no value provided
  });
}

/**
 * Recursively substitute variables in an object
 *
 * @param obj - Object to process
 * @param variables - Variable values to substitute
 * @returns Object with variables substituted in all string values
 */
function substituteInObject<T>(obj: T, variables: Record<string, string>): T {
  if (typeof obj === "string") {
    return substituteVariables(obj, variables) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => substituteInObject(item, variables)) as T;
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteInObject(value, variables);
    }
    return result as T;
  }

  return obj;
}

/**
 * Get default values for all variables in a template
 *
 * @param template - The stage template
 * @returns Record of variable names to default values
 */
export function getDefaultVariables(
  template: StageTemplate
): Record<string, string> {
  const defaults: Record<string, string> = {};

  if (template.variables) {
    for (const variable of template.variables) {
      if (variable.default !== undefined) {
        defaults[variable.name] = variable.default;
      }
    }
  }

  return defaults;
}

/**
 * Validate that all required variables are provided
 *
 * @param template - The stage template
 * @param variables - Provided variable values
 * @returns Array of missing required variable names
 */
export function validateRequiredVariables(
  template: StageTemplate,
  variables: Record<string, string>
): string[] {
  const missing: string[] = [];

  if (template.variables) {
    for (const variable of template.variables) {
      if (variable.required && !(variable.name in variables)) {
        missing.push(variable.name);
      }
    }
  }

  return missing;
}

/**
 * Get the list of variables used in a template (including those in stage config)
 *
 * @param template - The stage template
 * @returns Array of variable names found in the template
 */
export function getUsedVariables(template: StageTemplate): string[] {
  const variablePattern = /\{\{(\w+)\}\}/g;
  const found = new Set<string>();

  // Stringify the stage config to find all variable references
  const stageJson = JSON.stringify(template.stage);
  let match;

  while ((match = variablePattern.exec(stageJson)) !== null) {
    if (match[1]) {
      found.add(match[1]);
    }
  }

  return Array.from(found);
}

/**
 * Render a template with the provided variables
 *
 * @param template - The stage template
 * @param providedVariables - User-provided variable values
 * @returns Rendered pipeline item configuration
 */
export function renderTemplate(
  template: StageTemplate,
  providedVariables: Record<string, string> = {}
): PipelineItem {
  // Merge defaults with provided variables (provided takes precedence)
  const defaults = getDefaultVariables(template);
  const variables = { ...defaults, ...providedVariables };

  // Substitute variables in the stage configuration
  const renderedStage = substituteInObject(template.stage, variables);

  return renderedStage as PipelineItem;
}

/**
 * Get variable info for display purposes
 *
 * @param variables - Variable definitions
 * @returns Formatted variable info
 */
export function formatVariableInfo(
  variables: VariableDefinition[]
): Array<{
  name: string;
  label: string;
  required: boolean;
  default: string | undefined;
  description: string | undefined;
}> {
  return variables.map((v) => ({
    name: v.name,
    label: v.label,
    required: v.required ?? false,
    default: v.default,
    description: v.description,
  }));
}
