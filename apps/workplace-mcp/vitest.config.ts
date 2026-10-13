import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 테스트 서버의 임시 포트를 127.0.0.1 에 묶는다 — 다른 테스트 프로세스와 포트를 나눠 써 요청이 가로채이지 않게(loopbackListen.ts).
    setupFiles: ['./src/testing/loopbackListen.ts'],
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
