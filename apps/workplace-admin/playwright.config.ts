import { defineConfig, devices } from '@playwright/test'

// E2E 전용 포트 — CI 에서도 런마다 고유 포트(20000~29999)로 격리한다.
// 6174 에 떠 있는 개발 서버(APP_VERSION 없이 기동)를 재사용해 버전 표기 spec 이 깨지거나 병렬 세션이 서로 서버를
// 물지 않도록 한다. config 는 main + 각 worker 에서 따로 평가되므로 main 에서 한 번만 정해
// process.env.E2E_ADMIN_PORT 에 심어 worker 가 상속하게 한다(web 의 E2E_PORT 와 섞이지 않도록 이름을 분리).
if (!process.env.E2E_ADMIN_PORT) {
  process.env.E2E_ADMIN_PORT = String(20000 + Math.floor(Math.random() * 10000))
}
const PORT = Number(process.env.E2E_ADMIN_PORT)
const HOST = `http://localhost:${PORT}`

// Playwright E2E 설정 (workplace-admin).
// - Vite dev 서버를 자동 기동(위 PORT)하고 Chromium 에서 실행
// - 백엔드 호출은 page.route() 로 모킹 — workplace-api 미기동 상태에서도 실행 가능
// - 산출물: ../../test-results/e2e-admin
export default defineConfig({
  testDir: './e2e',
  outputDir: '../../test-results/e2e-admin',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 로컬 1회 재시도 = 게이트 안전망(web 과 동일). 전체 회귀에서 web E2E 직후 부하 속에 dev 서버 첫 화면이
  // 30초를 넘겨 로그인 화면 대기가 끊긴 일이 있었다(단독 재실행은 통과). 재시도 통과는 'flaky' 로 보고된다.
  retries: process.env.CI ? 2 : 1,
  // 로컬 워커 3 고정 — 코어 비율은 Chromium 초과 구독으로 시스템을 포화시킨다 (WP-98, web 과 동일).
  workers: process.env.CI ? 1 : 3,
  reporter: 'html',

  use: {
    baseURL: HOST,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // --port/--strictPort 로 PORT 강제 — 점유돼 있으면 조용히 다른 포트로 새지 않고 즉시 실패한다.
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: HOST,
    // 기존 서버 재사용 금지 — APP_VERSION 이 주입된 자체 서버만 쓴다.
    reuseExistingServer: false,
    timeout: 120_000,
    // 앱 버전 표기 E2E(admin-version.spec.ts)용 빌드 상수 — vite.config.ts 의 define 이 읽는다 (WP-439).
    env: { APP_VERSION: '0.9.0', GIT_SHA: 'a5d66d0e1234' },
  },
})
