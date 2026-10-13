import { defineConfig } from 'vitest/config';

// 동기화 서버 테스트 — 실제 Hocuspocus 서버(포트 0)와 Node 클라이언트를 띄우므로 node 환경.
// TipTap 헤드리스 변환기가 요구하는 DOM 전역은 각 테스트 첫 줄의 './dom-install' 이 설치한다(서버와 동일 경로).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15000,
    // 테스트 서버의 임시 포트를 127.0.0.1 에 묶는다 — 다른 테스트 프로세스와 포트를 나눠 써 요청이 가로채이지 않게(loopbackListen.ts).
    setupFiles: ['./src/testing/loopbackListen.ts'],
  },
});
