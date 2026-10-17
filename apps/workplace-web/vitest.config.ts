// workplace-web vitest 설정 — 두 프로젝트로 나눈다.
// - node: 순수 TS 함수(detectMention 등) 단위 테스트(src/**/*.test.ts). DOM 없이 돌아 빠르다.
//   DOM API(예: tiptap 라운드트립)가 필요한 .ts 파일만 `// @vitest-environment jsdom` docblock 으로 jsdom 을 켠다.
// - dom: React 컴포넌트 테스트(src/**/*.test.tsx, React Testing Library). 권한 분기·조건부 렌더·폼 payload 처럼
//   브라우저 레이아웃이 필요 없는 화면 로직을 E2E 대신 여기서 본다(WP-413). 레이아웃·실제 브라우저 이벤트는 E2E 가 맡는다.
import path from 'path'
import { defineConfig } from 'vitest/config';

import { appVersionDefine } from '../../scripts/vite-app-version.mjs'

export default defineConfig({
  // 빌드 상수 — vite.config.ts 와 같은 이름을 정의해야 이를 참조하는 모듈(collabSession 등)을 불러올 수 있다.
  // 단위 테스트는 운영 빌드와 같은 경로(E2E 네임스페이스 없음)를 검증한다.
  // 버전 표기 상수(__APP_VERSION__ 등)도 함께 정의해 이를 참조하는 모듈을 불러올 수 있게 한다(WP-439).
  define: { __E2E__: 'false', ...appVersionDefine() },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // vite.config.ts 와 같은 별칭 — 단위 테스트는 운영 빌드와 같은 저장소 루트 releases/ 를 본다(WP-439).
      '@release-notes': path.resolve(__dirname, '../../releases'),
    },
  },
  test: {
    globals: true,
    // 캘린더 종일 일정 로직은 로컬 타임존에 의존하므로 KST 로 고정해 결정적으로 검증한다
    // (UTC 호스트에서는 종일 ±9h 시프트 버그가 재현되지 않아 테스트가 헛돈다 — #493 교훈).
    env: { TZ: 'Asia/Seoul' },
    // extends: true — 위 define·alias·env·globals 를 두 프로젝트가 그대로 물려받는다.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          // jest-dom 매처·RTL cleanup·jsdom 에 없는 브라우저 API 보강 — 컴포넌트 테스트에만 필요하다.
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
