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
 * Get the path to the bundled templates directory
 */
function getTemplatesDir(): string {
  // When compiled, this file is at dist/cli/commands/init.js
  // Templates are at templates/ from project root
  return join(__dirname, "../../../templates");
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
    const format: AgentFormat = options.agents ? "agents" : "claude";
    const dotDir = format === "claude" ? ".claude" : ".agents";
    const fileName = format === "claude" ? "claude.md" : "agents.md";
    const targetPath = join(process.cwd(), dotDir, fileName);

    // Check if file already exists
    if (existsSync(targetPath) && !options.force && !options.append) {
      console.log(chalk.yellow("⚠") + ` ${dotDir}/${fileName} already exists`);
      console.log(
        chalk.dim("  Use --force to overwrite, --append to add content, or manually edit the file")
      );
      return 0;
    }

    // Create directory if it doesn't exist
    if (!existsSync(dotDir)) {
      mkdirSync(dotDir, { recursive: true });
      console.log(chalk.green("✓") + ` Created ${dotDir}/`);
    }

    // Copy template
    const templatesDir = getTemplatesDir();
    const templatePath = join(templatesDir, "agent-quick-start.md");

    if (!existsSync(templatePath)) {
      console.error(
        chalk.red("✗") + " Template file not found in package installation"
      );
      console.log(chalk.dim("  Expected: " + templatePath));
      console.log(
        "\nYou can view docs with: " + chalk.cyan("clier docs all")
      );
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
      console.log(chalk.green("✓") + ` Appended to ${dotDir}/${fileName}`);
    } else {
      // Write or overwrite
      await fs.writeFile(targetPath, templateContent, "utf-8");
      console.log(chalk.green("✓") + ` Created ${dotDir}/${fileName}`);
    }
    console.log(
      chalk.dim(
        "\n  This file provides a quick reference for AI agents working with Clier."
      )
    );
    console.log(
      chalk.dim("  Customize it as needed for your project's workflow.")
    );

    // Check if clier-pipeline.json exists
    const pipelinePath = join(process.cwd(), "clier-pipeline.json");
    if (!existsSync(pipelinePath)) {
      console.log(
        "\n" +
          chalk.yellow("ℹ") +
          " No clier-pipeline.json found in current directory"
      );
      console.log(
        chalk.dim("  See the template in ") +
          chalk.cyan(dotDir + "/" + fileName) +
          chalk.dim(" to get started")
      );
      console.log(
        chalk.dim("  Or run: ") + chalk.cyan("clier docs pipeline")
      );
    }

    return 0;
  } catch (error) {
    console.error(chalk.red("Error initializing agent documentation:"), error);
    return 1;
  }
}
