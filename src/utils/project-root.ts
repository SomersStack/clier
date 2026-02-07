/**
 * Project Root Discovery
 *
 * Utilities for finding the Clier project root directory by walking up
 * the directory tree, similar to how Git finds .git/ or npm finds package.json.
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

/**
 * Find the Clier project root by walking up the directory tree
 *
 * Looks for either:
 * 1. `.clier/` directory (indicates a running or previously run project)
 * 2. `clier-pipeline.json` file (indicates a configured project)
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @param lookFor - What to look for: 'daemon' (running project), 'config' (any project), or 'any' (either)
 * @returns Project root directory, or null if not found
 */
export function findProjectRoot(
  startDir: string = process.cwd(),
  lookFor: "daemon" | "config" | "any" = "any",
): string | null {
  // Resolve symlinks to get real path (e.g., /tmp -> /private/tmp on macOS)
  let currentDir = fs.realpathSync(path.resolve(startDir));
  const homeDir = fs.realpathSync(homedir());
  const rootDir = path.parse(currentDir).root;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Stop at home directory or filesystem root (before checking markers)
    // We don't want to treat home directory itself as a valid project root
    if (currentDir === homeDir || currentDir === rootDir) {
      return null;
    }

    // Check for .clier directory (running project)
    if (lookFor === "daemon" || lookFor === "any") {
      const clierDir = path.join(currentDir, ".clier");
      if (fs.existsSync(clierDir) && fs.statSync(clierDir).isDirectory()) {
        return currentDir;
      }
    }

    // Check for clier-pipeline.json (configured project)
    if (lookFor === "config" || lookFor === "any") {
      const configFile = path.join(currentDir, "clier-pipeline.json");
      if (fs.existsSync(configFile) && fs.statSync(configFile).isFile()) {
        return currentDir;
      }
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);

    // Safety check: if we can't go up anymore, stop
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

/**
 * Find project root for daemon operations (requires running daemon)
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Project root directory
 * @throws Error if no running daemon found
 */
export function findProjectRootForDaemon(
  startDir: string = process.cwd(),
): string {
  const root = findProjectRoot(startDir, "daemon");

  if (!root) {
    throw new Error(
      "No Clier project found. Make sure you're inside a project directory with a running daemon.\n" +
        "  • Run 'clier start' from the project root to start the daemon\n" +
        "  • Or navigate to a directory containing a .clier/ folder",
    );
  }

  return root;
}

/**
 * Find project root for config operations (requires clier-pipeline.json)
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Project root directory
 * @throws Error if no config found
 */
export function findProjectRootForConfig(
  startDir: string = process.cwd(),
): string {
  const root = findProjectRoot(startDir, "config");

  if (!root) {
    throw new Error(
      "No Clier project found. Make sure you're inside a project directory with a clier-pipeline.json file.\n" +
        "  • Create a clier-pipeline.json in your project root\n" +
        "  • Or navigate to a directory containing clier-pipeline.json",
    );
  }

  return root;
}

/**
 * Resolve config path, searching upward if not absolute
 *
 * If configPath is absolute, returns it as-is.
 * Otherwise, searches for clier-pipeline.json in parent directories.
 *
 * @param configPath - Optional config path (absolute or relative)
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Absolute path to config file
 * @throws Error if config not found
 */
export function resolveConfigPath(
  configPath?: string,
  startDir: string = process.cwd(),
): string {
  // If explicit path provided and it's absolute, use it
  if (configPath && path.isAbsolute(configPath)) {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
    return configPath;
  }

  // If explicit relative path provided, resolve from cwd
  if (configPath) {
    const resolved = path.resolve(startDir, configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found: ${resolved}`);
    }
    return resolved;
  }

  // Otherwise, search upward for clier-pipeline.json
  const projectRoot = findProjectRootForConfig(startDir);
  return path.join(projectRoot, "clier-pipeline.json");
}
