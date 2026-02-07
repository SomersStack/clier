import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Increase hook timeout for cleanup operations (E2E tests with watchers)
    hookTimeout: 30000,
    // Timeout for teardown hooks (afterEach, afterAll)
    teardownTimeout: 10000,
    // Use threads instead of forks to prevent orphan processes.
    // Worker threads are part of the main process and die with it,
    // unlike forked processes which can become orphaned when the parent is killed.
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },
    // Enable file-level parallelism (default true, explicit for clarity)
    fileParallelism: true,
    // Sequence configuration for test ordering
    sequence: {
      // Shuffle tests to detect order-dependent failures
      shuffle: false,
      // Run tests within a file concurrently for unit tests
      // Note: E2E tests may need sequential execution
      concurrent: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        'vitest.config.ts',
      ],
    },
  },
});
