/**
 * Clier Docs Command
 *
 * Display documentation for different subjects
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type DocSubject = "commands" | "pipeline" | "all";

/**
 * Available documentation subjects with their corresponding files
 */
const DOC_SUBJECTS: Record<DocSubject, string[]> = {
  commands: ["AGENTS.md"],
  pipeline: ["AGENTS-PIPELINE.md"],
  all: ["AGENTS.md", "AGENTS-PIPELINE.md"],
};

/**
 * Get the path to the bundled docs directory
 */
function getDocsDir(): string {
  // When compiled, this file is at dist/cli/commands/docs.js
  // Docs are at docs/ from project root
  return join(__dirname, "../../../docs");
}

/**
 * Display documentation for a given subject
 */
export async function docsCommand(options: {
  subject?: string;
  list?: boolean;
}): Promise<number> {
  try {
    const docsDir = getDocsDir();

    // List available subjects
    if (options.list) {
      console.log(chalk.bold("Available documentation subjects:\n"));
      console.log(chalk.cyan("  commands") + "  - CLI commands and workflows");
      console.log(
        chalk.cyan("  pipeline") + "  - Pipeline configuration guide"
      );
      console.log(
        chalk.cyan("  all") + "       - Complete agent documentation"
      );
      console.log("\nUsage:");
      console.log(chalk.dim("  clier docs [subject]"));
      console.log(chalk.dim("  clier docs commands"));
      console.log(chalk.dim("  clier docs pipeline"));
      console.log(chalk.dim("  clier docs all"));
      return 0;
    }

    // Determine which subject to display
    const subject = (options.subject || "all") as DocSubject;

    if (!DOC_SUBJECTS[subject]) {
      console.error(chalk.red(`Unknown subject: ${subject}`));
      console.log("\nAvailable subjects: commands, pipeline, all");
      console.log(chalk.dim("Run 'clier docs --list' for more info"));
      return 1;
    }

    // Read and display the requested documentation
    const files = DOC_SUBJECTS[subject];
    const content = files
      .map((file) => {
        try {
          return readFileSync(join(docsDir, file), "utf-8");
        } catch (error) {
          console.error(
            chalk.yellow(`Warning: Could not read ${file}`),
            error
          );
          return "";
        }
      })
      .filter((c) => c.length > 0)
      .join("\n\n" + "=".repeat(80) + "\n\n");

    if (content.length === 0) {
      console.error(chalk.red("No documentation found"));
      console.log(
        "\nOnline docs: " +
          chalk.blue("https://github.com/yourusername/clier/tree/main/docs")
      );
      return 1;
    }

    console.log(content);
    return 0;
  } catch (error) {
    console.error(chalk.red("Error reading documentation:"), error);
    return 1;
  }
}
