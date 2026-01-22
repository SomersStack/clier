/**
 * Validate Command
 *
 * Validates the clier-pipeline.json configuration file.
 */

import path from "path";
import { ZodError } from "zod";
import { loadConfig } from "../../config/loader.js";
import {
  printSuccess,
  printError,
  formatValidationErrors,
} from "../utils/formatter.js";

/**
 * Validate configuration file
 *
 * @param configPath - Path to configuration file (optional, defaults to clier-pipeline.json in cwd)
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function validateCommand(configPath?: string): Promise<number> {
  const configFile =
    configPath || path.join(process.cwd(), "clier-pipeline.json");

  try {
    // Try to load and validate config
    const config = await loadConfig(configFile);

    printSuccess(`Configuration is valid!`);
    console.log();
    console.log(`  Project: ${config.project_name}`);
    console.log(`  Pipeline items: ${config.pipeline.length}`);
    console.log(`  Global env: ${config.global_env ? "enabled" : "disabled"}`);
    console.log(`  Safety:`);
    console.log(`    - Max ops/min: ${config.safety.max_ops_per_minute}`);
    console.log(`    - Debounce: ${config.safety.debounce_ms}ms`);
    console.log();

    return 0;
  } catch (error) {
    if (error instanceof ZodError) {
      // Validation error - format nicely
      printError("Configuration validation failed");
      console.error(formatValidationErrors(error));
      return 1;
    }

    // Other errors (file not found, JSON parse error, etc.)
    printError(
      `Failed to validate configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}
