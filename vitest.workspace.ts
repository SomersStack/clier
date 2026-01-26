import { defineWorkspace } from 'vitest/config';

/**
 * Vitest workspace configuration for parallel test execution
 *
 * Projects:
 * - unit: Unit tests with maximum parallelism
 * - integration: Integration tests with file-level parallelism
 * - e2e: End-to-end tests with controlled parallelism
 * - performance: Performance tests run sequentially
 *
 * Usage:
 *   vitest --project unit      # Run only unit tests
 *   vitest --project e2e       # Run only e2e tests
 *   vitest                     # Run all tests
 */
export default defineWorkspace([
  {
    // Unit tests - maximum parallelism, isolated tests
    test: {
      name: 'unit',
      globals: true,
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: false,
          isolate: true,
        },
      },
      fileParallelism: true,
      testTimeout: 10000,
      hookTimeout: 10000,
      forceExit: true,
      teardownTimeout: 5000,
    },
  },
  {
    // Integration tests - file-level parallelism
    test: {
      name: 'integration',
      globals: true,
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: false,
          isolate: true,
        },
      },
      fileParallelism: true,
      testTimeout: 30000,
      hookTimeout: 15000,
      forceExit: true,
      teardownTimeout: 10000,
    },
  },
  {
    // E2E tests - controlled parallelism (may share resources)
    test: {
      name: 'e2e',
      globals: true,
      environment: 'node',
      include: ['tests/e2e/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: false,
          isolate: true,
        },
      },
      fileParallelism: true,
      testTimeout: 60000,
      hookTimeout: 30000,
      forceExit: true,
      teardownTimeout: 15000,
    },
  },
  {
    // Performance tests - run sequentially to get accurate measurements
    test: {
      name: 'performance',
      globals: true,
      environment: 'node',
      include: ['tests/performance/**/*.test.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          // Single fork for consistent performance measurements
          singleFork: true,
          isolate: true,
        },
      },
      fileParallelism: false,
      testTimeout: 120000,
      hookTimeout: 30000,
      forceExit: true,
      teardownTimeout: 15000,
    },
  },
]);
