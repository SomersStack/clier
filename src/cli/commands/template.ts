/**
 * Template Commands
 *
 * CLI commands for listing and applying pipeline stage templates.
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "fs";
import { join, dirname } from "path";
import chalk from "chalk";
import { printError, printSuccess, printWarning, printInfo } from "../utils/formatter.js";
import {
  loadTemplate,
  getTemplatesByCategory,
  getTemplateIds,
  loadBundledScript,
} from "../../templates/loader.js";
import {
  renderTemplate,
  getDefaultVariables,
  validateRequiredVariables,
  formatVariableInfo,
} from "../../templates/renderer.js";

/**
 * Options for listing templates
 */
export interface ListOptions {
  category?: "service" | "task" | "utility";
}

/**
 * Options for applying a template
 */
export interface ApplyOptions {
  name?: string;
  var?: string[];
  add?: boolean;
  output?: string;
  force?: boolean;
}

/**
 * List available pipeline stage templates
 *
 * @param options - Filter options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function templateListCommand(options: ListOptions = {}): Promise<number> {
  try {
    const grouped = getTemplatesByCategory();
    const hasTemplates = Object.values(grouped).some((arr) => arr.length > 0);

    if (!hasTemplates) {
      printWarning("No templates found");
      console.log();
      console.log(chalk.dim("  Templates should be in templates/stages/"));
      return 1;
    }

    console.log();
    console.log(chalk.bold("Pipeline Stage Templates"));
    console.log();

    // Filter by category if specified
    const categories = options.category
      ? [options.category]
      : (["service", "task", "utility"] as const);

    for (const category of categories) {
      const templates = grouped[category] || [];
      if (templates.length === 0) continue;

      console.log(chalk.yellow(category.toUpperCase()));

      for (const template of templates) {
        const idPadded = template.id.padEnd(16);
        console.log(`  ${chalk.cyan(idPadded)} ${template.description}`);
      }

      console.log();
    }

    console.log(chalk.dim(`Use 'clier template apply <id>' to generate a stage`));
    console.log();

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Apply a template to generate a pipeline stage
 *
 * @param templateId - Template ID to apply
 * @param options - Apply options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function templateApplyCommand(
  templateId: string,
  options: ApplyOptions = {}
): Promise<number> {
  try {
    // Load the template
    const template = loadTemplate(templateId);

    if (!template) {
      printError(`Template "${templateId}" not found`);
      console.log();
      console.log(chalk.dim("  Available templates:"));
      const ids = getTemplateIds();
      for (const id of ids) {
        console.log(chalk.dim(`    - ${id}`));
      }
      console.log();
      return 1;
    }

    // Parse variable options
    const variables: Record<string, string> = {};

    // If --name is provided, use it as the name variable
    if (options.name) {
      variables.name = options.name;
    }

    // Parse --var options (KEY=VALUE format)
    if (options.var) {
      for (const varStr of options.var) {
        const [key, ...valueParts] = varStr.split("=");
        if (!key || valueParts.length === 0) {
          printError(`Invalid variable format: ${varStr}`);
          console.log(chalk.dim("  Use: --var KEY=VALUE"));
          return 1;
        }
        variables[key] = valueParts.join("=");
      }
    }

    // Merge with defaults
    const defaults = getDefaultVariables(template);
    const mergedVariables = { ...defaults, ...variables };

    // Validate required variables
    const missing = validateRequiredVariables(template, mergedVariables);
    if (missing.length > 0) {
      printError(`Missing required variables: ${missing.join(", ")}`);
      console.log();
      console.log(chalk.dim("  Required variables:"));
      for (const varName of missing) {
        const varDef = template.variables?.find((v) => v.name === varName);
        console.log(chalk.dim(`    --var ${varName}=<value>${varDef?.description ? ` (${varDef.description})` : ""}`));
      }
      console.log();
      return 1;
    }

    // Render the template
    const stage = renderTemplate(template, mergedVariables);

    // Handle scripts if present
    const scriptsCreated: string[] = [];
    const scriptsSkipped: string[] = [];

    if (template.scripts && template.scripts.length > 0) {
      const cwd = process.cwd();

      for (const script of template.scripts) {
        const targetPath = join(cwd, script.path);
        const targetDir = dirname(targetPath);

        // Check if script already exists
        if (existsSync(targetPath) && !options.force) {
          scriptsSkipped.push(script.path);
          continue;
        }

        // Get script content
        let content: string | null = null;
        if (script.content) {
          content = script.content;
        } else if (script.bundledScript) {
          content = loadBundledScript(script.bundledScript);
        }

        if (!content) {
          printWarning(`Could not load script content for ${script.path}`);
          continue;
        }

        // Create directory if needed
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }

        // Write script
        writeFileSync(targetPath, content, "utf-8");

        // Make executable if needed
        if (script.executable) {
          chmodSync(targetPath, 0o755);
        }

        scriptsCreated.push(script.path);
      }
    }

    // Output the stage JSON
    if (options.add) {
      // Add to clier-pipeline.json
      const configPath = join(process.cwd(), "clier-pipeline.json");

      if (!existsSync(configPath)) {
        printError("clier-pipeline.json not found in current directory");
        console.log();
        console.log(chalk.dim("  Initialize with: clier init"));
        console.log(chalk.dim("  Or create a clier-pipeline.json file manually"));
        return 1;
      }

      // Load existing config
      const configContent = readFileSync(configPath, "utf-8");
      const config = JSON.parse(configContent);

      // Check for duplicate name
      if (config.pipeline?.some((item: { name: string }) => item.name === stage.name)) {
        printError(`Stage "${stage.name}" already exists in pipeline`);
        console.log(chalk.dim("  Use a different name: --name <name>"));
        return 1;
      }

      // Add stage to pipeline
      config.pipeline = config.pipeline || [];
      config.pipeline.push(stage);

      // Write back
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

      console.log();
      printSuccess(`Stage "${stage.name}" added to clier-pipeline.json`);

      if (scriptsCreated.length > 0) {
        console.log();
        console.log(chalk.dim("  Scripts created:"));
        for (const path of scriptsCreated) {
          console.log(chalk.dim(`    ${chalk.green("✓")} ${path}`));
        }
      }

      if (scriptsSkipped.length > 0) {
        console.log();
        console.log(chalk.dim("  Scripts skipped (already exist):"));
        for (const path of scriptsSkipped) {
          console.log(chalk.dim(`    ${chalk.yellow("⚠")} ${path}`));
        }
        console.log(chalk.dim("  Use --force to overwrite"));
      }

      console.log();
      printInfo("Run 'clier reload' to apply changes to the running daemon");
      console.log();

    } else if (options.output) {
      // Write to specified file
      const outputPath = join(process.cwd(), options.output);
      writeFileSync(outputPath, JSON.stringify(stage, null, 2) + "\n", "utf-8");

      printSuccess(`Stage written to ${options.output}`);

      if (scriptsCreated.length > 0) {
        console.log();
        console.log(chalk.dim("  Scripts created:"));
        for (const path of scriptsCreated) {
          console.log(chalk.dim(`    ${chalk.green("✓")} ${path}`));
        }
      }

    } else {
      // Output to stdout
      console.log(JSON.stringify(stage, null, 2));

      // Print script info to stderr if scripts were handled
      if (scriptsCreated.length > 0 || scriptsSkipped.length > 0) {
        console.error();
        if (scriptsCreated.length > 0) {
          console.error(chalk.dim("Scripts created:"));
          for (const path of scriptsCreated) {
            console.error(chalk.dim(`  ${chalk.green("✓")} ${path}`));
          }
        }
        if (scriptsSkipped.length > 0) {
          console.error(chalk.dim("Scripts skipped (already exist):"));
          for (const path of scriptsSkipped) {
            console.error(chalk.dim(`  ${chalk.yellow("⚠")} ${path}`));
          }
        }
      }
    }

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Show details for a specific template
 *
 * @param templateId - Template ID to show
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function templateShowCommand(templateId: string): Promise<number> {
  try {
    const template = loadTemplate(templateId);

    if (!template) {
      printError(`Template "${templateId}" not found`);
      console.log();
      console.log(chalk.dim("  Available templates:"));
      const ids = getTemplateIds();
      for (const id of ids) {
        console.log(chalk.dim(`    - ${id}`));
      }
      console.log();
      return 1;
    }

    console.log();
    console.log(chalk.bold(`Template: ${template.id}`));
    console.log();
    console.log(`  ${chalk.cyan(template.name)}`);
    console.log();
    console.log(`  ${template.description}`);
    console.log();
    console.log(`  ${chalk.dim("Category:")} ${template.category}`);

    if (template.tags && template.tags.length > 0) {
      console.log(`  ${chalk.dim("Tags:")} ${template.tags.join(", ")}`);
    }

    // Show variables
    if (template.variables && template.variables.length > 0) {
      console.log();
      console.log(chalk.yellow("VARIABLES"));

      const varInfo = formatVariableInfo(template.variables);
      for (const v of varInfo) {
        const required = v.required ? chalk.red("*") : " ";
        const defaultVal = v.default ? chalk.dim(` (default: "${v.default}")`) : "";
        console.log(`  ${required}${v.name.padEnd(16)} ${v.label}${defaultVal}`);
        if (v.description) {
          console.log(chalk.dim(`                    ${v.description}`));
        }
      }
    }

    // Show scripts
    if (template.scripts && template.scripts.length > 0) {
      console.log();
      console.log(chalk.yellow("SCRIPTS"));

      for (const script of template.scripts) {
        const exec = script.executable ? chalk.green(" (executable)") : "";
        console.log(`  ${script.path}${exec}`);
        if (script.description) {
          console.log(chalk.dim(`    ${script.description}`));
        }
      }
    }

    // Show stage preview
    console.log();
    console.log(chalk.yellow("STAGE CONFIGURATION"));
    console.log(chalk.dim(JSON.stringify(template.stage, null, 2).split("\n").map(l => "  " + l).join("\n")));

    // Usage example
    console.log();
    console.log(chalk.yellow("USAGE"));
    const hasRequiredVars = template.variables?.some((v) => v.required && !v.default);
    const exampleVars = hasRequiredVars
      ? template.variables
          ?.filter((v) => v.required && !v.default)
          .map((v) => `--var ${v.name}=<value>`)
          .join(" ") || ""
      : "";
    console.log(`  clier template apply ${template.id}${exampleVars ? " " + exampleVars : ""}`);
    console.log();

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
