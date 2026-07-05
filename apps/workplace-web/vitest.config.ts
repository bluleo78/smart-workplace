// workplace-web vitest 설정 — 순수 TS 함수(detectMention 등) 단위 테스트용.
// 환경은 node — DOM 없이 동작하는 순수 로직만 다룬다 (UI 회귀는 Playwright E2E 가 담당).
import path from 'path'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // 캘린더 종일 일정 로직은 로컬 타임존에 의존하므로 KST 로 고정해 결정적으로 검증한다
    // (UTC 호스트에서는 종일 ±9h 시프트 버그가 재현되지 않아 테스트가 헛돈다 — #493 교훈).
    env: { TZ: 'Asia/Seoul' },
  },
});
