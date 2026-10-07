import { defineConfig } from 'vitest/config';

// 동기화 서버 테스트 — 실제 Hocuspocus 서버(포트 0)와 Node 클라이언트를 띄우므로 node 환경.
// TipTap 헤드리스 변환기가 요구하는 DOM 전역은 각 테스트 첫 줄의 './dom-install' 이 설치한다(서버와 동일 경로).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
  },
});
