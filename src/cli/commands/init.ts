/**
 * Clier Init Command
 *
 * Initialize a project with agent documentation
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type AgentFormat = "claude" | "agents";

/**
 * Valid locations for agent instruction files (in order of precedence)
 */
const AGENT_FILE_LOCATIONS = [
  ".claude/CLAUDE.md",
  "AGENTS.md", // project root
  ".claude/AGENTS.md", // legacy location
];

/**
 * Get the path to the bundled templates directory
 */
function getTemplatesDir(): string {
  // When compiled, this file is at dist/cli/commands/init.js
  // Templates are at templates/ from project root
  return join(__dirname, "../../../templates");
}

/**
 * Find existing agent instruction file in any valid location
 */
function findExistingAgentFile(cwd: string): string | null {
  for (const location of AGENT_FILE_LOCATIONS) {
    const fullPath = join(cwd, location);
    if (existsSync(fullPath)) {
      return location;
    }
  }
  return null;
}

/**
 * Initialize agent documentation in the current project
 */
export async function initCommand(options: {
  agents?: boolean;
  force?: boolean;
  append?: boolean;
}): Promise<number> {
  try {
    const cwd = process.cwd();
    const format: AgentFormat = options.agents ? "agents" : "claude";

    // Default: .claude/CLAUDE.md
    // With --agents flag: AGENTS.md in root
    const targetPath =
      format === "claude"
        ? join(cwd, ".claude", "CLAUDE.md")
        : join(cwd, "AGENTS.md");
    const displayPath = format === "claude" ? ".claude/CLAUDE.md" : "AGENTS.md";

    // Check for existing AGENTS.md in any valid location
    const existingLocation = findExistingAgentFile(cwd);
    const existingPath = existingLocation ? join(cwd, existingLocation) : null;

    // If file exists in target location or any other valid location
    if (!options.force && !options.append) {
      if (existingPath === targetPath) {
        console.log(chalk.yellow("⚠") + ` ${displayPath} already exists`);
        console.log(
          chalk.dim(
            "  Use --force to overwrite, --append to add content, or manually edit the file",
          ),
        );
        return 0;
      } else if (existingLocation) {
        console.log(chalk.yellow("⚠") + ` Found existing ${existingLocation}`);
        console.log(
          chalk.dim("  Use --force to create a new file at " + displayPath),
        );
        console.log(chalk.dim("  Or manually edit the existing file"));
        return 0;
      }
    }

    // Create .claude directory if needed (only for claude format)
    if (format === "claude") {
      const dotDirPath = join(cwd, ".claude");
      if (!existsSync(dotDirPath)) {
        mkdirSync(dotDirPath, { recursive: true });
        console.log(chalk.green("✓") + " Created .claude/");
      }
    }

    // Copy template
    const templatesDir = getTemplatesDir();
    const templatePath = join(templatesDir, "agent-quick-start.md");

    if (!existsSync(templatePath)) {
      console.error(
        chalk.red("✗") + " Template file not found in package installation",
      );
      console.log(chalk.dim("  Expected: " + templatePath));
      console.log("\nYou can view docs with: " + chalk.cyan("clier docs all"));
      return 1;
    }

    // Read template
    const templateContent = readFileSync(templatePath, "utf-8");
    const fs = await import("fs/promises");

    // Handle append mode
    if (options.append && existsSync(targetPath)) {
      const existingContent = readFileSync(targetPath, "utf-8");
      const separator = "\n\n---\n\n";
      const newContent = existingContent + separator + templateContent;
      await fs.writeFile(targetPath, newContent, "utf-8");
      console.log(chalk.green("✓") + ` Appended to ${displayPath}`);
    } else {
      // Write or overwrite
      await fs.writeFile(targetPath, templateContent, "utf-8");
      console.log(chalk.green("✓") + ` Created ${displayPath}`);
    }
    console.log(
      chalk.dim(
        "\n  This file provides a quick reference for AI agents working with Clier.",
      ),
    );
    console.log(
      chalk.dim("  Customize it as needed for your project's workflow."),
    );

    // Check if clier-pipeline.json exists
    const pipelinePath = join(process.cwd(), "clier-pipeline.json");
    if (!existsSync(pipelinePath)) {
      console.log(
        "\n" +
          chalk.yellow("ℹ") +
          " No clier-pipeline.json found in current directory",
      );
      console.log(
        chalk.dim("  See the template in ") +
          chalk.cyan(displayPath) +
          chalk.dim(" to get started"),
      );
      console.log(chalk.dim("  Or run: ") + chalk.cyan("clier docs pipeline"));
    }

    return 0;
  } catch (error) {
    console.error(chalk.red("Error initializing agent documentation:"), error);
    return 1;
  }
}
