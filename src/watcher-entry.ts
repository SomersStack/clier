/**
 * Watcher Entry Point
 *
 * Can run in two modes:
 * 1. Daemon mode (CLIER_DAEMON_MODE=1) - runs as background daemon with IPC
 * 2. Direct mode - runs watcher directly (legacy, for testing)
 */

import path from "path";
import { Watcher } from "./watcher.js";
import { startDaemonMode } from "./daemon/index.js";
import { logger } from "./utils/logger.js";

// Check if running in daemon mode
if (process.env.CLIER_DAEMON_MODE === "1") {
  // Run as daemon with IPC server
  startDaemonMode().catch((error) => {
    logger.error("Failed to start daemon:", error);
    process.exit(1);
  });
} else {
  // Legacy direct mode - just run watcher
  const configPath =
    process.env.CLIER_CONFIG_PATH ||
    path.join(process.cwd(), "clier-pipeline.json");
  const projectRoot =
    process.env.CLIER_PROJECT_ROOT || path.dirname(configPath);
  const paused = process.env.CLIER_START_PAUSED === "1";

  const watcher = new Watcher();

  watcher.start(configPath, projectRoot, { paused }).catch((error) => {
    logger.error("Failed to start watcher:", error);
    process.exit(1);
  });
}
