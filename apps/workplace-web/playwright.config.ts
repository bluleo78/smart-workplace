import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI

// E2E 전용 포트.
// - CI: 단일 러너이므로 고정 6173.
// - 로컬: 병렬 Claude 세션이 각자 E2E/pre-commit 을 돌려도 같은 dev 서버를 물지 않도록
//   런마다 고유 포트로 격리한다(20000~29999, 앱 포트 6173/6174/7070/9090 회피).
//   ⚠️ config 는 main + 각 worker 프로세스에서 따로 평가되므로 process.pid 기반은 worker 마다
//   값이 달라져 baseURL≠서버포트(CONNECTION_REFUSED)가 된다. 그래서 main 에서 한 번만 정해
//   process.env.E2E_PORT 에 심고, 스폰되는 worker 가 이를 상속하게 한다. E2E_PORT 외부 오버라이드 허용.
if (!CI && !process.env.E2E_PORT) {
  process.env.E2E_PORT = String(20000 + Math.floor(Math.random() * 10000))
}
const PORT = Number(process.env.E2E_PORT ?? 6173)
const HOST = `http://localhost:${PORT}`

// Playwright E2E 설정.
// - Vite dev 서버를 자동 기동(위 PORT)하고 Chromium 에서 실행
// - 백엔드 호출은 page.route() 로 모킹 — workplace-api 미기동 상태에서도 실행 가능
// - 산출물: ../../test-results/e2e
export default defineConfig({
  testDir: './e2e',
  outputDir: '../../test-results/e2e',

  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : '80%',
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
    // --port/--strictPort 로 PORT 강제. 포트가 점유돼 있으면(드문 랜덤 충돌) 조용히 다른 포트로
    // 새지 않고 즉시 실패하도록 strictPort 를 둔다.
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: HOST,
    // 병렬 세션 격리를 위해 로컬에서도 기존 서버 재사용 금지(매 런 자체 서버 기동).
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
