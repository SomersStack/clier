/**
 * Pipeline Orchestrator
 *
 * Main orchestration logic for managing pipeline execution.
 * Tracks process dependencies, handles triggers, and starts dependent processes.
 */

import type { ClierConfig, PipelineItem } from "../config/types.js";
import type { ClierEvent } from "../types/events.js";
import type { ProcessManager, ProcessConfig } from "./process-manager.js";
import { createContextLogger } from "../utils/logger.js";
import {
  substituteEventTemplates,
  createTemplateContext,
} from "../utils/template.js";

const logger = createContextLogger("Orchestrator");

/**
 * Orchestrator class
 *
 * Manages pipeline execution by tracking triggers and starting dependent processes.
 *
 * @example
 * ```ts
 * const orchestrator = new Orchestrator(processManager);
 *
 * orchestrator.loadPipeline(config);
 * await orchestrator.start();
 *
 * // Handle events
 * orchestrator.handleEvent({
 *   name: 'backend:ready',
 *   processName: 'backend',
 *   type: 'custom',
 *   timestamp: Date.now()
 * });
 * ```
 */
/**
 * Options for Orchestrator
 */
export interface OrchestratorOptions {
  /**
   * Whether to spawn processes in detached mode (default: true)
   * Set to false in tests to ensure child processes die with the test runner
   */
  detached?: boolean;
}

export class Orchestrator {
  private processManager: ProcessManager;
  private config?: ClierConfig;
  private pipelineItems = new Map<string, PipelineItem>();
  private startedProcesses = new Set<string>();
  private manuallyTriggeredProcesses = new Set<string>();
  private receivedEvents = new Set<string>();
  private projectRoot?: string;
  private options: OrchestratorOptions;

  /**
   * Create a new Orchestrator
   *
   * @param processManager - ProcessManager instance
   * @param projectRoot - Project root directory for default cwd
   * @param options - Optional configuration options
   *
   * @example
   * ```ts
   * const orchestrator = new Orchestrator(processManager, '/project/root');
   * // For tests (prevents orphan processes):
   * const orchestrator = new Orchestrator(processManager, '/project/root', { detached: false });
   * ```
   */
  constructor(processManager: ProcessManager, projectRoot?: string, options?: OrchestratorOptions) {
    this.processManager = processManager;
    this.projectRoot = projectRoot;
    this.options = options || {};
  }

  /**
   * Load pipeline configuration
   *
   * @param config - Clier configuration
   * @throws Error if pipeline has circular dependencies or invalid trigger_on references
   *
   * @example
   * ```ts
   * orchestrator.loadPipeline(config);
   * ```
   */
  loadPipeline(config: ClierConfig): void {
    this.config = config;
    this.pipelineItems.clear();
    this.startedProcesses.clear();
    this.manuallyTriggeredProcesses.clear();
    this.receivedEvents.clear();

    // Build pipeline item map
    for (const item of config.pipeline) {
      this.pipelineItems.set(item.name, item);
    }

    // Validate pipeline
    this.validatePipeline();

    logger.info("Loaded pipeline", {
      itemCount: config.pipeline.length,
      entryPoints: this.getEntryPoints().length,
    });
  }

  /**
   * Validate pipeline configuration
   *
   * Checks for:
   * - Missing dependencies (trigger_on references non-existent events)
   * - Circular dependencies
   * - Unreachable processes
   */
  private validatePipeline(): void {
    if (!this.config) {
      return;
    }

    const allEventNames = new Set<string>();
    const warnings: string[] = [];

    // Collect all possible event names from pipeline items
    for (const item of this.config.pipeline) {
      // Only collect events if events config exists
      if (item.events) {
        // Events can be emitted by:
        // 1. Pattern matches (from events.on_stdout field)
        if (item.events.on_stdout) {
          for (const stdout of item.events.on_stdout) {
            allEventNames.add(stdout.emit);
          }
        }

        // 2. Process exit, error, and crash events
        allEventNames.add(`${item.name}:exit`);
        if (item.events.on_stderr) {
          allEventNames.add(`${item.name}:error`);
        }
        if (item.events.on_crash) {
          allEventNames.add(`${item.name}:crashed`);
        }
      }
    }

    // Check for missing dependencies
    for (const item of this.config.pipeline) {
      if (item.trigger_on && item.trigger_on.length > 0) {
        for (const trigger of item.trigger_on) {
          if (!allEventNames.has(trigger)) {
            warnings.push(
              `Process "${item.name}" waits for event "${trigger}" which may never be emitted`
            );
          }
        }
      }
    }

    // Log warnings
    for (const warning of warnings) {
      logger.warn(warning);
    }

    logger.debug("Pipeline validation completed", {
      warnings: warnings.length,
    });
  }

  /**
   * Start the pipeline
   *
   * Starts all entry point processes (those without trigger_on).
   *
   * @example
   * ```ts
   * await orchestrator.start();
   * ```
   */
  async start(): Promise<void> {
    if (!this.config) {
      throw new Error("No pipeline loaded. Call loadPipeline() first.");
    }

    const entryPoints = this.getEntryPoints();

    logger.info(`Starting ${entryPoints.length} entry point processes`);

    for (const item of entryPoints) {
      await this.startProcess(item);
    }
  }

  /**
   * Handle an event and trigger dependent processes
   *
   * @param event - ClierEvent to handle
   *
   * @example
   * ```ts
   * await orchestrator.handleEvent({
   *   name: 'backend:ready',
   *   processName: 'backend',
   *   type: 'custom',
   *   timestamp: Date.now()
   * });
   * ```
   */
  async handleEvent(event: ClierEvent): Promise<void> {
    if (!this.config) {
      logger.warn("Cannot handle event: No pipeline loaded");
      return;
    }

    logger.debug("Handling event", {
      eventName: event.name,
      processName: event.processName,
      type: event.type,
    });

    // Track received event
    this.receivedEvents.add(event.name);

    // Find processes waiting for this event
    const dependents = this.findDependents(event.name);

    if (dependents.length === 0) {
      logger.debug("No dependents found for event", { eventName: event.name });
      return;
    }

    logger.debug("Found dependents for event", {
      eventName: event.name,
      dependents: dependents.map((d) => d.name),
    });

    for (const dependent of dependents) {
      try {
        // Check if all triggers are satisfied
        if (this.areAllTriggersSatisfied(dependent)) {
          // Check continue_on_failure for error/crash events
          if (this.shouldSkipDueToFailure(event, dependent)) {
            logger.info("Skipping process due to failure", {
              processName: dependent.name,
              reason: "continue_on_failure is false",
            });
            continue;
          }

          // Don't start if already started
          if (this.startedProcesses.has(dependent.name)) {
            logger.debug("Process already started, skipping", {
              processName: dependent.name,
            });
            continue;
          }

          await this.startProcess(dependent, event);
        } else {
          logger.debug("Not all triggers satisfied for process", {
            processName: dependent.name,
            required: dependent.trigger_on,
            received: Array.from(this.receivedEvents),
          });
        }
      } catch (error) {
        logger.error("Error processing dependent", {
          processName: dependent.name,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue processing other dependents
      }
    }
  }

  /**
   * Get entry point processes (no trigger_on and not manual)
   *
   * @returns Array of entry point pipeline items
   *
   * @example
   * ```ts
   * const entryPoints = orchestrator.getEntryPoints();
   * ```
   */
  getEntryPoints(): PipelineItem[] {
    return Array.from(this.pipelineItems.values()).filter(
      (item) =>
        !item.manual && (!item.trigger_on || item.trigger_on.length === 0)
    );
  }

  /**
   * Get processes waiting for triggers
   *
   * @returns Array of waiting pipeline items
   *
   * @example
   * ```ts
   * const waiting = orchestrator.getWaitingProcesses();
   * ```
   */
  getWaitingProcesses(): PipelineItem[] {
    return Array.from(this.pipelineItems.values()).filter(
      (item) =>
        item.trigger_on &&
        item.trigger_on.length > 0 &&
        !this.startedProcesses.has(item.name)
    );
  }

  /**
   * Directly start a specific pipeline stage, bypassing event triggers
   *
   * This allows manual triggering of stages that would normally wait for events.
   * The stage's dependents will still cascade when it completes.
   *
   * @param stageName - Name of the stage to start
   * @throws Error if no pipeline loaded, stage not found, or stage already running
   *
   * @example
   * ```ts
   * await orchestrator.triggerStage('build');
   * ```
   */
  async triggerStage(stageName: string): Promise<void> {
    if (!this.config) {
      throw new Error("No pipeline loaded. Call loadPipeline() first.");
    }

    const item = this.pipelineItems.get(stageName);
    if (!item) {
      throw new Error(`Stage "${stageName}" not found in pipeline`);
    }

    // Check if process is currently running (not just if it was ever started)
    if (this.processManager.isRunning(stageName)) {
      throw new Error(`Stage "${stageName}" is already running`);
    }

    // If process was started before but is no longer running (e.g., task completed),
    // allow it to be re-started by removing from startedProcesses
    if (this.startedProcesses.has(stageName)) {
      logger.debug("Removing completed stage from startedProcesses to allow restart", { stageName });
      this.startedProcesses.delete(stageName);
    }

    logger.info("Manually triggering stage", { stageName });
    await this.startProcess(item);

    // Track as manually triggered for clear restart functionality
    this.manuallyTriggeredProcesses.add(stageName);
  }

  /**
   * Get all stage names in the pipeline
   *
   * @returns Array of stage names
   */
  getStageNames(): string[] {
    return Array.from(this.pipelineItems.keys());
  }

  /**
   * Get processes that were manually triggered via triggerStage() and are currently running
   *
   * These are services that were started explicitly by the user (e.g., via `clier service start`)
   * rather than automatically by the pipeline or event triggers.
   *
   * Only returns processes that are currently running, not all that were ever manually triggered.
   *
   * @returns Array of manually triggered process names that are currently running
   */
  getManuallyTriggeredProcesses(): string[] {
    return Array.from(this.manuallyTriggeredProcesses).filter(name =>
      this.processManager.isRunning(name)
    );
  }

  /**
   * Check if a stage has input enabled in its pipeline config
   */
  hasStageInputEnabled(stageName: string): boolean {
    const item = this.pipelineItems.get(stageName);
    return item?.input?.enabled ?? false;
  }

  /**
   * Start a process
   *
   * @param item - Pipeline item to start
   * @param triggerEvent - Optional event that triggered this process (for template substitution)
   */
  private async startProcess(
    item: PipelineItem,
    triggerEvent?: ClierEvent,
  ): Promise<void> {
    if (!this.config) {
      logger.error("Cannot start process: No configuration loaded");
      throw new Error("No configuration loaded");
    }

    logger.info("Starting process", {
      processName: item.name,
      command: item.command,
      type: item.type,
      triggeredBy: triggerEvent?.name,
    });

    try {
      const processConfig = this.buildProcessConfig(item, triggerEvent);
      await this.processManager.startProcess(processConfig);
      this.startedProcesses.add(item.name);

      logger.info("Process started successfully", {
        processName: item.name,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to start process", {
        processName: item.name,
        command: item.command,
        error: errorMsg,
      });

      // Re-throw with more context
      throw new Error(`Failed to start process "${item.name}": ${errorMsg}`);
    }
  }

  /**
   * Build ProcessConfig from pipeline item
   *
   * @param item - Pipeline item configuration
   * @param triggerEvent - Optional event that triggered this process
   */
  private buildProcessConfig(
    item: PipelineItem,
    triggerEvent?: ClierEvent,
  ): ProcessConfig {
    let command = item.command;
    let env = item.env;

    // Apply event template substitution if enabled and triggered by event
    if (item.enable_event_templates && triggerEvent && this.config) {
      const templateContext = createTemplateContext(
        triggerEvent,
        item.name,
        item.type,
        this.config.project_name,
      );

      // Substitute templates in command
      const originalCommand = command;
      command = substituteEventTemplates(command, templateContext);

      // Log template substitution for debugging
      if (command !== originalCommand) {
        logger.debug("Applied event templates to command", {
          processName: item.name,
          originalCommand,
          resolvedCommand: command,
          triggerEvent: triggerEvent.name,
        });
      }

      // Substitute templates in environment variables
      if (env) {
        const resolvedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(env)) {
          resolvedEnv[key] = substituteEventTemplates(value, templateContext);
        }
        env = resolvedEnv;

        logger.debug("Applied event templates to environment variables", {
          processName: item.name,
          triggerEvent: triggerEvent.name,
        });
      }
    }

    const config: ProcessConfig = {
      name: item.name,
      command,
      // Use item's cwd if specified, otherwise default to project root
      cwd: item.cwd || this.projectRoot,
      type: item.type,
      // Determine restart mode from config, defaulting based on type
      restart: (() => {
        const restartMode = item.restart ?? (item.type === "service" ? "on-failure" : "never");
        if (restartMode === "never") return undefined;
        return {
          enabled: true,
          maxRetries: 10,
          delay: 1000,
          backoff: "exponential" as const,
          maxDelay: 60000,
          mode: restartMode,
        };
      })(),
      // Pass through detached option (defaults to true if not specified)
      // Set to false in tests to prevent orphan processes
      detached: this.options.detached,
      // Pass through input configuration for stdin support
      input: item.input ? { enabled: item.input.enabled } : undefined,
    };

    // Handle environment variables
    if (this.config?.global_env) {
      // Merge global env with item env, filtering out undefined values
      const globalEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          globalEnv[key] = value;
        }
      }
      config.env = {
        ...globalEnv,
        ...env,
      };
    } else {
      config.env = env;
    }

    return config;
  }

  /**
   * Find processes that depend on a specific event
   * Manual stages are excluded - they can only be triggered via triggerStage()
   */
  private findDependents(eventName: string): PipelineItem[] {
    return Array.from(this.pipelineItems.values()).filter(
      (item) => !item.manual && item.trigger_on?.includes(eventName)
    );
  }

  /**
   * Check if all triggers for a process are satisfied
   */
  private areAllTriggersSatisfied(item: PipelineItem): boolean {
    if (!item.trigger_on || item.trigger_on.length === 0) {
      return true;
    }

    return item.trigger_on.every((trigger) => this.receivedEvents.has(trigger));
  }

  /**
   * Check if process should be skipped due to failure and continue_on_failure setting
   */
  private shouldSkipDueToFailure(
    event: ClierEvent,
    _dependent: PipelineItem
  ): boolean {
    // If event is an error or crash
    const isFailureEvent = event.type === "error" || event.type === "crashed";

    if (!isFailureEvent) {
      return false;
    }

    // Get the source process (the one that failed)
    const sourceProcess = this.pipelineItems.get(event.processName);

    if (!sourceProcess) {
      return false;
    }

    // If continue_on_failure is explicitly false or undefined, skip
    // If continue_on_failure is true, don't skip
    return sourceProcess.continue_on_failure !== true;
  }
}
