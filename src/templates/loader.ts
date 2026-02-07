/**
 * Template Loader
 *
 * Utilities for loading pipeline stage templates from the bundled templates directory.
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { stageTemplateSchema, templateManifestSchema } from "./schema.js";
import type {
  StageTemplate,
  TemplateManifest,
  ListTemplatesOptions,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the path to the bundled templates directory
 */
export function getTemplatesDir(): string {
  // When compiled, this file is at dist/templates/loader.js
  // Templates are at templates/ from project root
  return join(__dirname, "../../templates");
}

/**
 * Get the path to the stage templates directory
 */
export function getStageTemplatesDir(): string {
  return join(getTemplatesDir(), "stages");
}

/**
 * Load the template manifest
 *
 * @returns The template manifest or null if not found
 */
export function loadTemplateManifest(): TemplateManifest | null {
  const manifestPath = join(getStageTemplatesDir(), "index.json");

  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const data = JSON.parse(content);
    return templateManifestSchema.parse(data);
  } catch {
    return null;
  }
}

/**
 * Load a specific template by ID
 *
 * @param templateId - The template ID to load
 * @returns The template or null if not found
 */
export function loadTemplate(templateId: string): StageTemplate | null {
  const templatePath = join(getStageTemplatesDir(), `${templateId}.json`);

  if (!existsSync(templatePath)) {
    return null;
  }

  try {
    const content = readFileSync(templatePath, "utf-8");
    const data = JSON.parse(content);
    return stageTemplateSchema.parse(data);
  } catch {
    return null;
  }
}

/**
 * List all available templates
 *
 * @param options - Filter options
 * @returns Array of templates
 */
export function listTemplates(
  options: ListTemplatesOptions = {},
): StageTemplate[] {
  const manifest = loadTemplateManifest();

  if (!manifest) {
    return [];
  }

  const templates: StageTemplate[] = [];

  for (const templateId of manifest.templates) {
    const template = loadTemplate(templateId);
    if (template) {
      // Apply category filter if specified
      if (options.category && template.category !== options.category) {
        continue;
      }
      templates.push(template);
    }
  }

  return templates;
}

/**
 * Get templates grouped by category
 *
 * @returns Templates grouped by category
 */
export function getTemplatesByCategory(): Record<string, StageTemplate[]> {
  const templates = listTemplates();
  const grouped: Record<string, StageTemplate[]> = {
    service: [],
    task: [],
    utility: [],
  };

  for (const template of templates) {
    const category = template.category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category]!.push(template);
  }

  return grouped;
}

/**
 * Check if a template exists
 *
 * @param templateId - The template ID to check
 * @returns True if the template exists
 */
export function templateExists(templateId: string): boolean {
  const templatePath = join(getStageTemplatesDir(), `${templateId}.json`);
  return existsSync(templatePath);
}

/**
 * Get all template IDs
 *
 * @returns Array of template IDs
 */
export function getTemplateIds(): string[] {
  const manifest = loadTemplateManifest();
  return manifest?.templates ?? [];
}

/**
 * Load bundled script content
 *
 * @param scriptName - Name of the bundled script file
 * @returns Script content or null if not found
 */
export function loadBundledScript(scriptName: string): string | null {
  const scriptPath = join(getStageTemplatesDir(), "scripts", scriptName);

  if (!existsSync(scriptPath)) {
    return null;
  }

  try {
    return readFileSync(scriptPath, "utf-8");
  } catch {
    return null;
  }
}
