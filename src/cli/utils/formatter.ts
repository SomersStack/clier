/**
 * CLI Output Formatter
 *
 * Utilities for pretty-printing CLI output with colors and tables.
 */

import chalk from "chalk";
import { ZodError } from "zod";

/**
 * Format bytes to human-readable format
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 GB")
 */
export function formatMemory(bytes: number | undefined): string {
  if (!bytes) return "N/A";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format uptime to human-readable format
 *
 * @param uptime - Uptime in milliseconds
 * @returns Formatted string (e.g., "2h 30m")
 */
export function formatUptime(uptime: number | undefined): string {
  if (!uptime) return "N/A";

  const seconds = Math.floor(uptime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format process status with color
 *
 * @param status - Process status
 * @returns Colored status string
 */
export function formatStatus(status: string | undefined): string {
  if (!status) return chalk.gray("unknown");

  switch (status) {
    case "running":
      return chalk.green("running");
    case "restarting":
      return chalk.yellow("restarting");
    case "stopped":
      return chalk.red("stopped");
    case "crashed":
      return chalk.red("crashed");
    default:
      return chalk.gray(status);
  }
}

/**
 * Format CPU usage
 *
 * @param cpu - CPU usage percentage
 * @returns Formatted string
 */
export function formatCPU(cpu: number | undefined): string {
  if (cpu === undefined) return "N/A";
  return `${cpu.toFixed(1)}%`;
}

/**
 * Print a success message
 *
 * @param message - Success message
 */
export function printSuccess(message: string): void {
  console.log(chalk.green("✓"), message);
}

/**
 * Print an error message
 *
 * @param message - Error message
 */
export function printError(message: string): void {
  console.error(chalk.red("✗"), message);
}

/**
 * Print a warning message
 *
 * @param message - Warning message
 */
export function printWarning(message: string): void {
  console.warn(chalk.yellow("⚠"), message);
}

/**
 * Print an info message
 *
 * @param message - Info message
 */
export function printInfo(message: string): void {
  console.log(chalk.blue("ℹ"), message);
}

/**
 * Format Zod validation errors with enhanced context and suggestions
 *
 * @param error - ZodError instance
 * @param rawConfig - Optional raw config object for additional context
 * @returns Formatted error string
 */
export function formatValidationErrors(
  error: ZodError,
  rawConfig?: unknown,
): string {
  // Group errors by pipeline item
  const pipelineErrors = new Map<
    string,
    Array<{ path: string; message: string; code: string }>
  >();
  const globalErrors: Array<{ path: string; message: string; code: string }> =
    [];

  for (const err of error.errors) {
    const pathStr = err.path.join(".");
    const errorInfo = { path: pathStr, message: err.message, code: err.code };

    // Check if this is a pipeline item error
    if (err.path[0] === "pipeline" && typeof err.path[1] === "number") {
      const itemIndex = err.path[1];
      const itemKey = `pipeline.${itemIndex}`;

      if (!pipelineErrors.has(itemKey)) {
        pipelineErrors.set(itemKey, []);
      }
      pipelineErrors.get(itemKey)!.push(errorInfo);
    } else {
      globalErrors.push(errorInfo);
    }
  }

  const output: string[] = [];
  output.push(`\n${chalk.red.bold("Configuration validation failed:")}\n`);

  // Format global errors
  if (globalErrors.length > 0) {
    output.push(chalk.yellow("Global Configuration:"));
    for (const err of globalErrors) {
      const formattedError = formatSingleError(err.path, err.message, err.code);
      output.push(`  ${chalk.red("•")} ${formattedError}`);
    }
    output.push("");
  }

  // Format pipeline errors with context
  if (pipelineErrors.size > 0) {
    for (const [itemKey, errors] of pipelineErrors.entries()) {
      const itemIndex = parseInt(itemKey.split(".")[1] || "0");
      const itemName = getPipelineItemName(rawConfig, itemIndex);

      output.push(chalk.yellow(`Pipeline Item ${itemName}:`));

      for (const err of errors) {
        // Remove "pipeline.X." prefix from path for cleaner output
        const shortPath = err.path.replace(/^pipeline\.\d+\./, "");
        const formattedError = formatSingleError(
          shortPath,
          err.message,
          err.code || "unknown",
          itemIndex,
          rawConfig,
        );
        output.push(`  ${chalk.red("•")} ${formattedError}`);
      }
      output.push("");
    }
  }

  return output.join("\n");
}

/**
 * Get a human-readable name for a pipeline item
 */
function getPipelineItemName(rawConfig: unknown, index: number): string {
  try {
    if (
      rawConfig &&
      typeof rawConfig === "object" &&
      "pipeline" in rawConfig &&
      Array.isArray(rawConfig.pipeline)
    ) {
      const item = rawConfig.pipeline[index];
      if (item && typeof item === "object") {
        if ("name" in item && typeof item.name === "string" && item.name) {
          return `"${item.name}"`;
        }
        if ("command" in item && typeof item.command === "string") {
          const shortCmd =
            item.command.length > 30
              ? item.command.substring(0, 27) + "..."
              : item.command;
          return `#${index + 1} (${shortCmd})`;
        }
      }
    }
  } catch {
    // Fall through to default
  }
  return `#${index + 1}`;
}

/**
 * Format a single validation error with helpful context
 */
function formatSingleError(
  path: string,
  message: string,
  code: string,
  itemIndex?: number,
  rawConfig?: unknown,
): string {
  const parts: string[] = [];

  // Main error message
  if (code === "invalid_type" && message.includes("Required")) {
    // Missing field
    parts.push(chalk.bold(path) + ": " + chalk.red("Missing required field"));

    // Add helpful examples
    const suggestion = getSuggestionForMissingField(path);
    if (suggestion) {
      parts.push(`\n    ${chalk.dim("Expected:")} ${chalk.cyan(suggestion)}`);
    }
  } else if (
    code === "invalid_enum_value" ||
    message.includes("Invalid enum")
  ) {
    // Invalid enum - extract allowed values
    const actual = getActualValue(rawConfig, itemIndex, path);
    parts.push(
      chalk.bold(path) +
        ": " +
        chalk.red(`Invalid value${actual ? ` "${actual}"` : ""}`),
    );

    // Try to extract expected values from the message
    // Match "Expected 'value1' or 'value2'" pattern
    const match = message.match(/Expected (.+?)$/);
    if (match) {
      parts.push(`\n    ${chalk.dim("Expected:")} ${chalk.cyan(match[1])}`);
    } else {
      // Fallback for known enum fields
      const suggestion = getSuggestionForMissingField(path);
      if (suggestion) {
        parts.push(`\n    ${chalk.dim("Expected:")} ${chalk.cyan(suggestion)}`);
      }
    }
  } else if (message.includes("must not be empty")) {
    // Empty string
    const actual = getActualValue(rawConfig, itemIndex, path);
    parts.push(
      chalk.bold(path) +
        ": " +
        chalk.red(
          `Cannot be empty${actual === "" ? " (empty string provided)" : ""}`,
        ),
    );
  } else if (message.includes("duplicate name")) {
    // Duplicate pipeline names
    parts.push(chalk.red("Duplicate pipeline names found"));
    parts.push(
      `\n    ${chalk.dim("Each pipeline item must have a unique name")}`,
    );
  } else {
    // Generic error
    parts.push(chalk.bold(path) + ": " + message);
  }

  return parts.join("");
}

/**
 * Get suggestion for a missing field
 */
function getSuggestionForMissingField(path: string): string | null {
  if (path === "type") {
    return '"service" or "task"';
  } else if (path === "events") {
    return '{ "on_stdout": [], "on_stderr": true, "on_crash": true }';
  } else if (path.endsWith(".pattern")) {
    return '"regex pattern to match"';
  } else if (path.endsWith(".emit")) {
    return '"event-name"';
  } else if (path === "command") {
    return '"command to execute"';
  } else if (path === "name") {
    return '"unique-name"';
  }
  return null;
}

/**
 * Try to get the actual value from the raw config
 */
function getActualValue(
  rawConfig: unknown,
  itemIndex: number | undefined,
  path: string,
): string | null {
  try {
    if (!rawConfig || typeof rawConfig !== "object") return null;

    let obj: any = rawConfig;

    // Navigate to pipeline item if needed
    if (itemIndex !== undefined) {
      if (!("pipeline" in obj) || !Array.isArray(obj.pipeline)) return null;
      obj = obj.pipeline[itemIndex];
      if (!obj) return null;
    }

    // Navigate to the field
    const pathParts = path.split(".");
    for (const part of pathParts) {
      if (obj && typeof obj === "object" && part in obj) {
        obj = obj[part];
      } else {
        return null;
      }
    }

    if (typeof obj === "string") return obj;
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Print header with project name
 *
 * @param projectName - Project name
 */
export function printHeader(projectName: string): void {
  console.log();
  console.log(chalk.bold.cyan(`Clier - ${projectName}`));
  console.log(chalk.gray("─".repeat(50)));
  console.log();
}
