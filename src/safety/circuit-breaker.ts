/**
 * Circuit Breaker for process operations
 *
 * Wraps Opossum circuit breaker to prevent cascading failures.
 * When error threshold is exceeded, the circuit opens and stops
 * executing the protected function, emitting events that can trigger
 * webhooks or other actions.
 */

import CircuitBreakerLib from "opossum";

/**
 * Circuit breaker configuration options
 */
export interface CircuitBreakerOptions {
  /** Timeout in milliseconds (default: 3000) */
  timeout?: number;
  /** Error threshold percentage to open circuit (default: 50) */
  errorThresholdPercentage?: number;
  /** Time in milliseconds before attempting to close an open circuit (default: 30000) */
  resetTimeout?: number;
  /** Minimum number of requests before circuit can open (default: 10) */
  volumeThreshold?: number;
}

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  /** Total number of function calls */
  fires: number;
  /** Total number of successful calls */
  successes: number;
  /** Total number of failed calls */
  failures: number;
  /** Total number of rejected calls (circuit open) */
  rejects: number;
  /** Total number of timeouts */
  timeouts: number;
}

/**
 * Event handler function type for circuit breaker
 */
export type CircuitBreakerEventHandler = (...args: any[]) => void;

/**
 * CircuitBreaker class
 *
 * Wraps Opossum to provide circuit breaker functionality for process operations.
 * Emits events when circuit state changes, which can be used to trigger webhooks.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({
 *   timeout: 3000,
 *   errorThresholdPercentage: 50,
 *   resetTimeout: 30000
 * });
 *
 * breaker.on('open', () => {
 *   console.log('Circuit breaker opened!');
 * });
 *
 * const protectedFn = breaker.protect(async () => {
 *   await riskyOperation();
 * });
 *
 * await protectedFn();
 * ```
 */
export class CircuitBreaker {
  private breakers: Map<string, CircuitBreakerLib<any[], any>> = new Map();
  private options: CircuitBreakerLib.Options;
  private defaultBreaker: CircuitBreakerLib<any[], any>;

  /**
   * Create a new CircuitBreaker
   *
   * @param options - Circuit breaker configuration options
   *
   * @example
   * ```ts
   * const breaker = new CircuitBreaker({
   *   timeout: 5000,
   *   errorThresholdPercentage: 60
   * });
   * ```
   */
  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 3000,
      errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
      resetTimeout: options.resetTimeout ?? 30000,
      volumeThreshold: options.volumeThreshold ?? 10,
    };

    // Create a default breaker for the protect method
    this.defaultBreaker = new CircuitBreakerLib(async () => {}, this.options);
  }

  /**
   * Protect a function with circuit breaker
   *
   * Returns a wrapped version of the function that is protected by the circuit breaker.
   * If the circuit is open, calls will fail fast without executing the function.
   *
   * @param fn - Function to protect
   * @returns Protected function
   *
   * @example
   * ```ts
   * const protectedFn = breaker.protect(async (id: string) => {
   *   return await fetchData(id);
   * });
   *
   * const result = await protectedFn('123');
   * ```
   */
  protect<T extends (...args: any[]) => any>(
    fn: T,
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
    const breaker = new CircuitBreakerLib(fn, this.options);
    const key = `protect-${this.breakers.size}`;
    this.breakers.set(key, breaker);

    // Forward all events to default breaker for centralized event handling
    const events: Array<
      | "success"
      | "failure"
      | "timeout"
      | "reject"
      | "open"
      | "halfOpen"
      | "close"
      | "fallback"
    > = [
      "success",
      "failure",
      "timeout",
      "reject",
      "open",
      "halfOpen",
      "close",
      "fallback",
    ];

    for (const event of events) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (breaker as any).on(event, (...args: any[]) => {
        (this.defaultBreaker as any).emit(event, ...args);
      });
    }

    return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      return breaker.fire(...args) as Promise<Awaited<ReturnType<T>>>;
    };
  }

  /**
   * Subscribe to circuit breaker events
   *
   * Available events:
   * - 'success': Function executed successfully
   * - 'failure': Function failed
   * - 'timeout': Function timed out
   * - 'reject': Call rejected (circuit open)
   * - 'open': Circuit opened
   * - 'halfOpen': Circuit half-open (testing if it should close)
   * - 'close': Circuit closed
   * - 'fallback': Fallback function executed
   *
   * @param event - Event name
   * @param handler - Event handler function
   *
   * @example
   * ```ts
   * breaker.on('open', () => {
   *   console.log('Circuit breaker opened!');
   * });
   *
   * breaker.on('failure', (error) => {
   *   console.error('Operation failed:', error);
   * });
   * ```
   */
  on(
    event:
      | "success"
      | "failure"
      | "timeout"
      | "reject"
      | "open"
      | "halfOpen"
      | "close"
      | "fallback",
    handler: CircuitBreakerEventHandler,
  ): void {
    this.defaultBreaker.on(event as any, handler);
  }

  /**
   * Get circuit breaker statistics
   *
   * @returns Statistics object
   *
   * @example
   * ```ts
   * const stats = breaker.getStats();
   * console.log(`Success rate: ${stats.successes / stats.fires * 100}%`);
   * ```
   */
  getStats(): CircuitBreakerStats {
    const stats = this.defaultBreaker.stats;

    return {
      fires: stats.fires,
      successes: stats.successes,
      failures: stats.failures,
      rejects: stats.rejects,
      timeouts: stats.timeouts,
    };
  }

  /**
   * Shutdown the circuit breaker
   *
   * Cleans up all event listeners and resources.
   *
   * @example
   * ```ts
   * breaker.shutdown();
   * ```
   */
  shutdown(): void {
    this.defaultBreaker.shutdown();

    for (const breaker of this.breakers.values()) {
      breaker.shutdown();
    }

    this.breakers.clear();
  }
}
