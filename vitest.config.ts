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
