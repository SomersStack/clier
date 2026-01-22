/**
 * Rate Limiter for process operations
 *
 * Limits the number of operations (process starts) per minute using Bottleneck.
 * Prevents runaway process creation by queuing operations and executing them
 * at a controlled rate.
 */

import Bottleneck from "bottleneck";

/**
 * RateLimiter class
 *
 * Wraps Bottleneck to provide rate limiting for process operations.
 * Limits operations per minute and queues excess operations.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter(60); // Max 60 operations per minute
 *
 * await limiter.schedule(async () => {
 *   await startProcess('backend');
 * });
 * ```
 */
export class RateLimiter {
  private limiter: Bottleneck;

  /**
   * Create a new RateLimiter
   *
   * @param maxOpsPerMinute - Maximum number of operations per minute
   * @throws Error if maxOpsPerMinute is not positive
   *
   * @example
   * ```ts
   * const limiter = new RateLimiter(60);
   * ```
   */
  constructor(maxOpsPerMinute: number) {
    if (maxOpsPerMinute <= 0) {
      throw new Error("maxOpsPerMinute must be greater than 0");
    }

    // Configure Bottleneck
    // reservoir: max operations available initially
    // reservoirRefreshAmount: how many operations to add on refresh
    // reservoirRefreshInterval: how often to refresh (in ms)
    this.limiter = new Bottleneck({
      reservoir: maxOpsPerMinute,
      reservoirRefreshAmount: maxOpsPerMinute,
      reservoirRefreshInterval: 60000, // 1 minute in milliseconds
      maxConcurrent: null, // No concurrency limit, only rate limit
      minTime: 0, // No minimum time between jobs
    });
  }

  /**
   * Schedule an operation for execution
   *
   * If the rate limit is exceeded, the operation will be queued
   * and executed when capacity is available.
   *
   * @param fn - Function to execute (can be sync or async)
   * @returns Promise that resolves with the function's return value
   *
   * @example
   * ```ts
   * const result = await limiter.schedule(async () => {
   *   return await someOperation();
   * });
   * ```
   */
  async schedule<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.limiter.schedule(async () => fn());
  }

  /**
   * Update the maximum operations per minute
   *
   * @param maxOpsPerMinute - New maximum operations per minute
   * @throws Error if maxOpsPerMinute is not positive
   *
   * @example
   * ```ts
   * limiter.updateMaxOpsPerMinute(120);
   * ```
   */
  updateMaxOpsPerMinute(maxOpsPerMinute: number): void {
    if (maxOpsPerMinute <= 0) {
      throw new Error("maxOpsPerMinute must be greater than 0");
    }

    // Update Bottleneck configuration
    this.limiter.updateSettings({
      reservoir: maxOpsPerMinute,
      reservoirRefreshAmount: maxOpsPerMinute,
    });
  }

  /**
   * Get the current queue length
   *
   * @returns Number of operations waiting in queue
   *
   * @example
   * ```ts
   * const queueLength = limiter.getQueueLength();
   * console.log(`${queueLength} operations queued`);
   * ```
   */
  getQueueLength(): number {
    return this.limiter.counts().QUEUED;
  }

  /**
   * Stop the rate limiter and wait for pending operations
   *
   * @param options - Stop options
   * @returns Promise that resolves when stopped
   *
   * @example
   * ```ts
   * await limiter.stop();
   * ```
   */
  async stop(options?: { dropWaitingJobs?: boolean }): Promise<void> {
    await this.limiter.stop(options);
  }
}
