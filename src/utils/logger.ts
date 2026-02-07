import winston from "winston";
import path from "path";
import { existsSync, mkdirSync } from "fs";

/**
 * Console log format with timestamp and colorized output
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(
    ({ timestamp, level, message, stack, context, ...meta }) => {
      const contextStr = context ? ` [${context}]` : "";
      const metaStr =
        Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";

      if (stack) {
        return `${timestamp} [${level}]${contextStr}: ${message}${metaStr}\n${stack}`;
      }
      return `${timestamp} [${level}]${contextStr}: ${message}${metaStr}`;
    },
  ),
);

/**
 * File log format with JSON structure for easier parsing
 */
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

/**
 * Get or create the log directory
 *
 * @param projectRoot - Optional project root directory. If not provided, will not create directories.
 */
function getLogDirectory(projectRoot?: string): string | null {
  // If no project root provided, return null (don't create directories)
  if (!projectRoot) {
    return null;
  }

  const logDir = path.join(projectRoot, ".clier", "logs");

  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch (error) {
      // If we can't create the log directory, fall back to console only
      console.warn(`Failed to create log directory: ${logDir}`);
      return null;
    }
  }

  return logDir;
}

/**
 * Create a Winston logger instance
 *
 * @param options - Logger configuration options
 * @returns Configured Winston logger
 *
 * @example
 * ```ts
 * const logger = createLogger({ level: 'debug', context: 'EventBus' });
 * logger.info('Application started');
 * logger.error('Something went wrong', { error });
 * ```
 */
export function createLogger(options: {
  level?: string;
  silent?: boolean;
  context?: string;
  enableFileLogging?: boolean;
  projectRoot?: string;
}): winston.Logger {
  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ];

  // Add file transports if enabled AND project root is provided
  if (options.enableFileLogging !== false && options.projectRoot) {
    const logDir = getLogDirectory(options.projectRoot);

    if (logDir) {
      try {
        // Combined log file (all levels)
        transports.push(
          new winston.transports.File({
            filename: path.join(logDir, "combined.log"),
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
          }),
        );

        // Error log file (errors only)
        transports.push(
          new winston.transports.File({
            filename: path.join(logDir, "error.log"),
            level: "error",
            format: fileFormat,
            maxsize: 10 * 1024 * 1024, // 10MB
            maxFiles: 5,
            tailable: true,
          }),
        );
      } catch (error) {
        // If file logging fails, just use console
        console.warn("Failed to initialize file logging:", error);
      }
    }
  }

  const logger = winston.createLogger({
    level: options.level ?? "info",
    silent: options.silent ?? false,
    transports,
    defaultMeta: options.context ? { context: options.context } : undefined,
  });

  return logger;
}

/**
 * Create a child logger with a specific context
 *
 * @param context - Context name (e.g., 'EventBus', 'Orchestrator')
 * @returns Logger instance with context
 *
 * @example
 * ```ts
 * const logger = createContextLogger('EventBus');
 * logger.info('Connected to PM2'); // [EventBus] Connected to PM2
 * ```
 */
export function createContextLogger(context: string): winston.Logger {
  return logger.child({ context });
}

/**
 * Default logger instance for the application
 *
 * Uses environment variable LOG_LEVEL if set, otherwise defaults to 'info'
 * Uses CLIER_PROJECT_ROOT for file logging if available
 */
export const logger = createLogger({
  level: process.env["LOG_LEVEL"] ?? "info",
  enableFileLogging: process.env["DISABLE_FILE_LOGGING"] !== "true",
  projectRoot: process.env["CLIER_PROJECT_ROOT"],
});
