/**
 * Version Checker Utility
 *
 * Checks for updates to the clier package by comparing
 * the current version with the latest version on npm.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const execAsync = promisify(exec);

// Get package.json path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, "../../../package.json");

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
}

/**
 * Get the current version from package.json
 *
 * @returns Current version string
 */
function getCurrentVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version;
  } catch (error) {
    throw new Error(
      `Failed to read current version: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the latest version from npm registry
 *
 * @returns Latest version string
 */
async function getLatestVersion(): Promise<string> {
  try {
    const { stdout } = await execAsync("npm view clier version");
    return stdout.trim();
  } catch (error) {
    // If package doesn't exist on npm yet, return current version
    // This allows the command to work during development
    const err = error as Error & { stderr?: string };
    if (err.stderr?.includes("404") || err.stderr?.includes("Not Found")) {
      return getCurrentVersion();
    }
    throw new Error(
      `Failed to fetch latest version: ${err.stderr || err.message}`,
    );
  }
}

/**
 * Compare two semantic versions
 *
 * @param current - Current version (e.g., "0.2.0")
 * @param latest - Latest version (e.g., "0.3.0")
 * @returns True if latest is newer than current
 */
function isNewer(current: string, latest: string): boolean {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const curr = currentParts[i] || 0;
    const lat = latestParts[i] || 0;

    if (lat > curr) return true;
    if (lat < curr) return false;
  }

  return false;
}

/**
 * Check for updates to clier
 *
 * @returns Update information
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  const latestVersion = await getLatestVersion();
  const hasUpdate = isNewer(currentVersion, latestVersion);

  return {
    currentVersion,
    latestVersion,
    hasUpdate,
  };
}

/**
 * Check if we should show the update prompt
 * Shows the prompt at most once per day
 *
 * @returns True if we should show the update prompt
 */
export function shouldShowUpdatePrompt(): boolean {
  try {
    const cacheDir = join(homedir(), ".clier");
    const cacheFile = join(cacheDir, "last-update-check");

    // Create cache directory if it doesn't exist
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    // Check when we last showed the prompt
    if (existsSync(cacheFile)) {
      const lastCheck = parseInt(readFileSync(cacheFile, "utf-8"), 10);
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Don't show prompt if we checked less than a day ago
      if (now - lastCheck < oneDayMs) {
        return false;
      }
    }

    // Update the last check time
    writeFileSync(cacheFile, Date.now().toString(), "utf-8");
    return true;
  } catch {
    // If anything fails, don't show the prompt
    return false;
  }
}
