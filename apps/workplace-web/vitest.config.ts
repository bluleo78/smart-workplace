// workplace-web vitest 설정 — 순수 TS 함수(detectMention 등) 단위 테스트용.
// 환경은 node — DOM 없이 동작하는 순수 로직만 다룬다 (UI 회귀는 Playwright E2E 가 담당).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
