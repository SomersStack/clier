/**
 * Debouncer for preventing rapid-fire event processing
 *
 * Delays execution of functions until after a specified time has elapsed
 * since the last invocation. If the same key is debounced again before
 * the delay expires, the previous invocation is cancelled.
 */

/**
 * Debouncer class
 *
 * Manages debounced function execution with configurable delay.
 * Each debounced function is identified by a unique key.
 *
 * @example
 * ```ts
 * const debouncer = new Debouncer(100);
 *
 * // Rapid calls with same key
 * debouncer.debounce('restart-backend', () => restartProcess('backend'));
 * debouncer.debounce('restart-backend', () => restartProcess('backend'));
 * debouncer.debounce('restart-backend', () => restartProcess('backend'));
 *
 * // Only the last call executes after 100ms
 * ```
 */
export class Debouncer {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private delay: number;

  /**
   * Create a new Debouncer
   *
   * @param delay - Delay in milliseconds (default: 0)
   *
   * @example
   * ```ts
   * const debouncer = new Debouncer(100);
   * ```
   */
  constructor(delay: number = 0) {
    this.delay = delay;
  }

  /**
   * Debounce a function execution
   *
   * If the same key is debounced again before the delay expires,
   * the previous invocation is cancelled and the new one is scheduled.
   *
   * @param key - Unique identifier for this debounced function
   * @param fn - Function to execute after delay
   *
   * @example
   * ```ts
   * debouncer.debounce('process-restart', () => {
   *   console.log('Restarting process...');
   * });
   * ```
   */
  debounce(key: string, fn: () => void | Promise<void>): void {
    // Cancel previous timer if exists
    this.cancel(key);

    // Schedule new execution
    const timer = setTimeout(() => {
      this.timers.delete(key);
      fn();
    }, this.delay);

    this.timers.set(key, timer);
  }

  /**
   * Cancel a pending debounced function
   *
   * @param key - Key of the debounced function to cancel
   *
   * @example
   * ```ts
   * debouncer.cancel('process-restart');
   * ```
   */
  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Cancel all pending debounced functions
   *
   * @example
   * ```ts
   * debouncer.cancelAll();
   * ```
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Check if a debounced function is pending
   *
   * @param key - Key to check
   * @returns True if the function is pending execution
   *
   * @example
   * ```ts
   * if (debouncer.isPending('process-restart')) {
   *   console.log('Restart is pending...');
   * }
   * ```
   */
  isPending(key: string): boolean {
    return this.timers.has(key);
  }
}
