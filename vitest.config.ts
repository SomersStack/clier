import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Increase hook timeout for cleanup operations (E2E tests with watchers)
    hookTimeout: 30000,
    // Use forks for test isolation - each test file runs in its own process
    // This prevents resource contention and accumulated slowdown
    pool: 'forks',
    // Configure fork pool for parallel execution
    poolOptions: {
      forks: {
        // Run test files in parallel
        singleFork: false,
        // Isolate globals between test files
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
