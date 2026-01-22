import { readFile } from "fs/promises";
import { ZodError } from "zod";
import { configSchema } from "./schema.js";
import type { ClierConfig } from "./types.js";

/**
 * Error thrown when configuration loading fails
 */
export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = "ConfigLoadError";
  }
}

/**
 * Loads and validates a Clier configuration file
 *
 * @param filePath - Absolute path to the configuration JSON file
 * @returns Validated configuration object
 * @throws {ConfigLoadError} If file cannot be read or parsed
 * @throws {ZodError} If configuration validation fails
 *
 * @example
 * ```ts
 * try {
 *   const config = await loadConfig('./clier-pipeline.json');
 *   console.log(`Loaded config for project: ${config.project_name}`);
 * } catch (error) {
 *   if (error instanceof ZodError) {
 *     console.error('Validation errors:', error.errors);
 *   } else {
 *     console.error('Failed to load config:', error);
 *   }
 * }
 * ```
 */
export async function loadConfig(filePath: string): Promise<ClierConfig> {
  try {
    // Read file
    const fileContent = await readFile(filePath, "utf-8");

    // Parse JSON
    let rawConfig: unknown;
    try {
      rawConfig = JSON.parse(fileContent);
    } catch (error) {
      throw new ConfigLoadError(
        `Failed to parse JSON from ${filePath}`,
        error instanceof Error ? error : undefined,
      );
    }

    // Validate with Zod schema
    const config = configSchema.parse(rawConfig);

    return config;
  } catch (error) {
    // Re-throw ZodError as-is for detailed validation messages
    if (error instanceof ZodError) {
      throw error;
    }

    // Re-throw ConfigLoadError as-is
    if (error instanceof ConfigLoadError) {
      throw error;
    }

    // Wrap other errors
    throw new ConfigLoadError(
      `Failed to load configuration from ${filePath}`,
      error instanceof Error ? error : undefined,
    );
  }
}

/**
 * Validates a configuration object without loading from file
 *
 * Useful for testing or when configuration is already in memory.
 *
 * @param config - Raw configuration object to validate
 * @returns Validated configuration object
 * @throws {ZodError} If configuration validation fails
 *
 * @example
 * ```ts
 * const rawConfig = {
 *   project_name: 'test',
 *   safety: { max_ops_per_minute: 60, debounce_ms: 100 },
 *   pipeline: []
 * };
 *
 * const validated = validateConfig(rawConfig);
 * ```
 */
export function validateConfig(config: unknown): ClierConfig {
  return configSchema.parse(config);
}

/**
 * Formats Zod validation errors into a human-readable string
 *
 * @param error - ZodError instance from schema validation
 * @returns Formatted error message
 *
 * @example
 * ```ts
 * try {
 *   validateConfig(invalidConfig);
 * } catch (error) {
 *   if (error instanceof ZodError) {
 *     console.error(formatValidationErrors(error));
 *   }
 * }
 * ```
 */
export function formatValidationErrors(error: ZodError): string {
  const errors = error.errors.map((err) => {
    const path = err.path.join(".");
    return `  - ${path}: ${err.message}`;
  });

  return `Configuration validation failed:\n${errors.join("\n")}`;
}
