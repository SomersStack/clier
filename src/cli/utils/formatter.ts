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
 * Format Zod validation errors
 *
 * @param error - ZodError instance
 * @returns Formatted error string
 */
export function formatValidationErrors(error: ZodError): string {
  const errors = error.errors.map((err) => {
    const path = err.path.length > 0 ? err.path.join(".") : "root";
    return `  ${chalk.red("•")} ${chalk.bold(path)}: ${err.message}`;
  });

  return `\n${chalk.red.bold("Configuration validation failed:")}\n${errors.join("\n")}`;
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
