/**
 * Main Watcher class
 *
 * Integrates all components to create the complete orchestration system.
 * Uses native child_process management instead of PM2.
 */

import path from "path";
import { loadConfig } from "./config/loader.js";
import { EventBus } from "./core/event-bus.js";
import { ProcessManager } from "./core/process-manager.js";
import { LogManager } from "./core/log-manager.js";
import { PatternMatcher } from "./core/pattern-matcher.js";
import { EventHandler } from "./core/event-handler.js";
import { Orchestrator } from "./core/orchestrator.js";
import { Debouncer } from "./safety/debouncer.js";
import { RateLimiter } from "./safety/rate-limiter.js";
import { CircuitBreaker } from "./safety/circuit-breaker.js";
import type { ClierConfig } from "./config/types.js";
import type { ClierEvent } from "./types/events.js";
import { createContextLogger } from "./utils/logger.js";

const logger = createContextLogger("Watcher");

/**
 * Watcher class
 *
 * Main orchestration engine that integrates all components.
 *
 * @example
 * ```ts
 * const watcher = new Watcher();
 * await watcher.start('./clier-pipeline.json');
 *
 * // Graceful shutdown
 * process.on('SIGINT', async () => {
 *   await watcher.stop();
 *   process.exit(0);
 * });
 * ```
 */
export class Watcher {
  private config?: ClierConfig;
  private processManager?: ProcessManager;
  private logManager?: LogManager;
  private eventBus?: EventBus;
  private patternMatcher?: PatternMatcher;
  private eventHandler?: EventHandler;
  private orchestrator?: Orchestrator;
  private debouncer?: Debouncer;
  private rateLimiter?: RateLimiter;
  private circuitBreaker?: CircuitBreaker;
  private started = false;
  private shuttingDown = false;
  private cleanupPromise?: Promise<void>;
  private projectRoot?: string;
  private signalHandlers?: {
    sigint: () => void;
    sigterm: () => void;
  };
  private detached?: boolean;

  /**
   * Start the watcher
   *
   * Loads configuration, initializes all components, and starts the pipeline.
   *
   * @param configPath - Path to clier-pipeline.json
   * @param projectRoot - Project root directory (defaults to dirname of configPath)
   * @param options - Additional options
   * @param options.setupSignalHandlers - Whether to register SIGINT/SIGTERM handlers (default: true)
   *                                      Set to false when running under a daemon that manages signals
   * @param options.detached - Whether to spawn processes in detached mode (default: true)
   *                           Set to false in tests to ensure child processes die with the test runner
   * @throws Error if configuration loading, initialization, or pipeline start fails
   *
   * @example
   * ```ts
   * await watcher.start('./clier-pipeline.json', '/project/root');
   * // When running under daemon:
   * await watcher.start('./clier-pipeline.json', '/project/root', { setupSignalHandlers: false });
   * // When running in tests:
   * await watcher.start('./clier-pipeline.json', '/project/root', { detached: false });
   * ```
   */
  async start(configPath: string, projectRoot?: string, options?: { setupSignalHandlers?: boolean; detached?: boolean }): Promise<void> {
    if (this.started) {
      logger.warn("Watcher already started");
      return;
    }

    try {
      // Store project root (default to dirname of config if not provided)
      this.projectRoot = projectRoot || path.dirname(configPath);
      // Store detached option (default true, set false in tests to prevent orphan processes)
      this.detached = options?.detached;

      logger.info("Starting Clier watcher", { configPath, projectRoot: this.projectRoot, detached: this.detached });

      // Load configuration
      try {
        this.config = await loadConfig(configPath);
        logger.info("Configuration loaded successfully", {
          projectName: this.config.project_name,
          pipelineItems: this.config.pipeline.length,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to load configuration", {
          configPath,
          error: errorMsg,
        });
        throw new Error(`Configuration load failed: ${errorMsg}`);
      }

      // Initialize components
      try {
        await this.initializeComponents();
        logger.debug("All components initialized successfully");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to initialize components", { error: errorMsg });
        throw new Error(`Component initialization failed: ${errorMsg}`);
      }

      // Setup signal handlers for graceful shutdown (unless running under daemon)
      if (options?.setupSignalHandlers !== false) {
        this.setupSignalHandlers();
      }

      // Start pipeline
      try {
        await this.orchestrator!.start();
        logger.info("Pipeline started successfully");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error("Failed to start pipeline", { error: errorMsg });
        throw new Error(`Pipeline start failed: ${errorMsg}`);
      }

      this.started = true;
      logger.info("Clier watcher started successfully");
    } catch (error) {
      logger.error("Failed to start watcher", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the watcher
   *
   * Performs graceful shutdown of all components.
   * If already shutting down, waits for the existing shutdown to complete.
   *
   * @example
   * ```ts
   * await watcher.stop();
   * ```
   */
  async stop(): Promise<void> {
    // If cleanup is already in progress, wait for it to complete
    // This prevents the race condition where daemon exits before processes are killed
    if (this.shuttingDown) {
      logger.warn("Already shutting down, waiting for cleanup to complete");
      if (this.cleanupPromise) {
        await this.cleanupPromise;
      }
      return;
    }

    if (!this.started) {
      logger.debug("Watcher not started, nothing to stop");
      return;
    }

    this.shuttingDown = true;
    logger.info("Stopping Clier watcher...");

    // Store the cleanup promise so other callers can wait for it
    this.cleanupPromise = this.cleanup();
    await this.cleanupPromise;

    this.started = false;
    this.shuttingDown = false;
    this.cleanupPromise = undefined;
    logger.info("Clier watcher stopped");
  }

  /**
   * Get the log manager (for CLI log queries)
   */
  getLogManager(): LogManager | undefined {
    return this.logManager;
  }

  /**
   * Get the process manager (for CLI status queries)
   */
  getProcessManager(): ProcessManager | undefined {
    return this.processManager;
  }

  /**
   * Get the orchestrator (for manual triggering operations)
   */
  getOrchestrator(): Orchestrator | undefined {
    return this.orchestrator;
  }

  /**
   * Get the event handler (for event history queries)
   */
  getEventHandler(): EventHandler | undefined {
    return this.eventHandler;
  }

  /**
   * Emit a custom event manually
   *
   * This allows external systems (CLI, agents) to emit events that trigger
   * waiting stages. The event flows through the normal event handling pipeline
   * including debouncing and rate limiting.
   *
   * @param eventName - Name of the event to emit
   * @param data - Optional data payload for event templates
   * @returns Array of stage names that are waiting for this event
   * @throws Error if watcher not started
   *
   * @example
   * ```ts
   * const triggered = await watcher.emitEvent('build:complete', { version: '1.0.0' });
   * console.log('Stages waiting for this event:', triggered);
   * ```
   */
  async emitEvent(
    eventName: string,
    data?: string | Record<string, unknown>
  ): Promise<string[]> {
    if (!this.eventHandler || !this.orchestrator) {
      throw new Error("Watcher not started");
    }

    // Find stages waiting for this event (before emitting)
    const waitingForThisEvent = this.orchestrator
      .getWaitingProcesses()
      .filter((p) => p.trigger_on?.includes(eventName))
      .map((p) => p.name);

    // Create and emit the event
    const event: ClierEvent = {
      name: eventName,
      processName: "manual",
      type: "custom",
      data,
      timestamp: Date.now(),
    };

    logger.info("Emitting manual event", { eventName, data });

    // Emit through event handler (flows through debouncing/rate limiting)
    this.eventHandler.emit(eventName, event);

    return waitingForThisEvent;
  }

  /**
   * Directly trigger a pipeline stage by name
   *
   * Bypasses the event waiting system to start a specific stage immediately.
   * The stage's dependents will still cascade when it completes.
   *
   * @param stageName - Name of the stage to trigger
   * @throws Error if watcher not started or stage not found
   *
   * @example
   * ```ts
   * await watcher.triggerStage('deploy');
   * ```
   */
  async triggerStage(stageName: string): Promise<void> {
    if (!this.orchestrator) {
      throw new Error("Watcher not started");
    }

    await this.orchestrator.triggerStage(stageName);
  }

  /**
   * Initialize all components
   */
  private async initializeComponents(): Promise<void> {
    if (!this.config) {
      throw new Error("Configuration not loaded");
    }

    // Initialize safety mechanisms
    try {
      this.debouncer = new Debouncer(this.config.safety.debounce_ms);
      this.rateLimiter = new RateLimiter(this.config.safety.max_ops_per_minute);

      // Use circuit breaker config from config file, with sensible defaults
      const cbConfig = this.config.safety.circuit_breaker;
      this.circuitBreaker = new CircuitBreaker({
        timeout: cbConfig?.timeout_ms ?? 30000,
        errorThresholdPercentage: 50,
        resetTimeout: cbConfig?.reset_timeout_ms ?? 60000,
        volumeThreshold: cbConfig?.error_threshold ?? 10,
      });
      logger.debug("Safety mechanisms initialized", {
        debounceMs: this.config.safety.debounce_ms,
        maxOpsPerMinute: this.config.safety.max_ops_per_minute,
        circuitBreakerTimeout: cbConfig?.timeout_ms ?? 30000,
        circuitBreakerResetTimeout: cbConfig?.reset_timeout_ms ?? 60000,
        circuitBreakerErrorThreshold: cbConfig?.error_threshold ?? 10,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to initialize safety mechanisms", {
        error: errorMsg,
      });
      throw new Error(`Safety mechanism initialization failed: ${errorMsg}`);
    }

    // Initialize ProcessManager (no PM2 connection needed!)
    try {
      this.processManager = new ProcessManager();
      logger.debug("Process manager initialized");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to initialize process manager", { error: errorMsg });
      throw new Error(`Process manager initialization failed: ${errorMsg}`);
    }

    // Initialize LogManager
    try {
      this.logManager = new LogManager({
        logDir: ".clier/logs",
        maxMemoryEntries: 1000,
        persistLogs: true,
      });
      logger.debug("Log manager initialized");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to initialize log manager", { error: errorMsg });
      throw new Error(`Log manager initialization failed: ${errorMsg}`);
    }

    // Initialize EventBus (connects to ProcessManager)
    try {
      this.eventBus = new EventBus(this.processManager);
      await this.eventBus.connect();
      logger.debug("Event bus connected");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to connect event bus", { error: errorMsg });
      throw new Error(`Event bus connection failed: ${errorMsg}`);
    }

    // Initialize remaining components
    try {
      this.patternMatcher = new PatternMatcher();
      this.eventHandler = new EventHandler(this.patternMatcher);
      this.orchestrator = new Orchestrator(this.processManager, this.projectRoot, {
        detached: this.detached,
      });
      logger.debug("Core components initialized");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to initialize core components", { error: errorMsg });
      throw new Error(`Core component initialization failed: ${errorMsg}`);
    }

    // Register pipeline items with event handler
    try {
      for (const item of this.config.pipeline) {
        this.eventHandler.registerPipelineItem(item);
      }
      logger.debug("Pipeline items registered", {
        count: this.config.pipeline.length,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to register pipeline items", { error: errorMsg });
      throw new Error(`Pipeline registration failed: ${errorMsg}`);
    }

    // Load pipeline into orchestrator
    try {
      this.orchestrator.loadPipeline(this.config);
      logger.debug("Pipeline loaded into orchestrator");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to load pipeline", { error: errorMsg });
      throw new Error(`Pipeline load failed: ${errorMsg}`);
    }

    // Connect event flows
    try {
      this.setupEventFlows();
      logger.debug("Event flows configured");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to setup event flows", { error: errorMsg });
      throw new Error(`Event flow setup failed: ${errorMsg}`);
    }

    // Setup circuit breaker monitoring
    try {
      this.setupCircuitBreaker();
      logger.debug("Circuit breaker configured");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Failed to setup circuit breaker", { error: errorMsg });
      throw new Error(`Circuit breaker setup failed: ${errorMsg}`);
    }

    logger.debug("All components initialized successfully");
  }

  /**
   * Setup event flows between components
   */
  private setupEventFlows(): void {
    if (
      !this.eventBus ||
      !this.eventHandler ||
      !this.orchestrator ||
      !this.debouncer ||
      !this.rateLimiter ||
      !this.logManager
    ) {
      return;
    }

    // EventBus stdout → EventHandler + LogManager
    this.eventBus.on("stdout", (event: ClierEvent) => {
      this.eventHandler!.handleEvent(event);
      if (typeof event.data === "string") {
        this.logManager!.add(event.processName, "stdout", event.data);
      }
    });

    // EventBus stderr → EventHandler + LogManager
    this.eventBus.on("stderr", (event: ClierEvent) => {
      this.eventHandler!.handleEvent(event);
      if (typeof event.data === "string") {
        this.logManager!.add(event.processName, "stderr", event.data);
      }
    });

    // EventBus process:exit → EventHandler
    this.eventBus.on("process:exit", (event: ClierEvent) => {
      this.eventHandler!.handleEvent(event);
    });

    // EventHandler events → Orchestrator (with debouncing and rate limiting)
    const handleOrchestratorEvent = (event: ClierEvent) => {
      const key = `${event.processName}:${event.name}`;

      this.debouncer!.debounce(key, () => {
        this.rateLimiter!.schedule(async () => {
          try {
            await this.orchestrator!.handleEvent(event);
          } catch (error) {
            logger.error(`Error handling event ${event.name}:`, error);
          }
        }).catch((error) => {
          logger.error(`Rate limiter error for event ${event.name}:`, error);
        });
      });
    };

    // Subscribe to all custom events
    // We need to capture events from EventHandler
    // For simplicity, we'll use a proxy pattern
    const originalEmit = this.eventHandler.emit.bind(this.eventHandler);
    this.eventHandler.emit = (eventName: string, event: ClierEvent) => {
      originalEmit(eventName, event);
      handleOrchestratorEvent(event);
    };

    logger.debug("Event flows configured");
  }

  /**
   * Setup circuit breaker monitoring
   */
  private setupCircuitBreaker(): void {
    if (!this.circuitBreaker) {
      return;
    }

    this.circuitBreaker.on("open", () => {
      logger.error("Circuit breaker opened - too many failures detected");

      // Emit circuit-breaker:triggered event
      // This can be used to trigger webhooks or other actions
      const event: ClierEvent = {
        name: "circuit-breaker:triggered",
        processName: "system",
        type: "custom",
        timestamp: Date.now(),
      };

      this.eventHandler?.emit("circuit-breaker:triggered", event);
    });

    this.circuitBreaker.on("halfOpen", () => {
      logger.info("Circuit breaker half-open - testing if system recovered");
    });

    this.circuitBreaker.on("close", () => {
      logger.info("Circuit breaker closed - system recovered");
    });

    logger.debug("Circuit breaker configured");
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.stop();
      process.exit(0);
    };

    // Store references so we can remove them during cleanup
    this.signalHandlers = {
      sigint: () => handleShutdown("SIGINT"),
      sigterm: () => handleShutdown("SIGTERM"),
    };

    process.on("SIGINT", this.signalHandlers.sigint);
    process.on("SIGTERM", this.signalHandlers.sigterm);
  }

  /**
   * Cleanup all components
   */
  private async cleanup(): Promise<void> {
    try {
      // Remove signal handlers to prevent memory leaks
      if (this.signalHandlers) {
        process.removeListener("SIGINT", this.signalHandlers.sigint);
        process.removeListener("SIGTERM", this.signalHandlers.sigterm);
        this.signalHandlers = undefined;
      }

      // Cancel all pending debounced operations
      this.debouncer?.cancelAll();

      // Stop rate limiter
      await this.rateLimiter?.stop({ dropWaitingJobs: false });

      // Shutdown circuit breaker
      this.circuitBreaker?.shutdown();

      // Disconnect from event bus
      await this.eventBus?.disconnect();

      // Shutdown all processes gracefully
      await this.processManager?.shutdown(5000);

      // Flush logs
      await this.logManager?.flush();

      logger.debug("Cleanup completed");
    } catch (error) {
      logger.error("Error during cleanup:", error);
    }
  }
}
