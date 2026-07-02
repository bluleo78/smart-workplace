import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'dist/**',
        'node_modules/**',
        '**/*.test.ts',
        '**/*.d.ts',
        'vitest.config.ts',
      ],
    },
  },
});
