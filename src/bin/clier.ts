#!/usr/bin/env node

/**
 * Clier CLI Binary
 *
 * Executable entry point for the Clier CLI.
 */

import { runCLI } from "../cli/index.js";

// Run the CLI with process arguments
runCLI(process.argv).catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
