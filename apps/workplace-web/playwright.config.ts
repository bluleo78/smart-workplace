import { defineConfig, devices } from '@playwright/test'

// Playwright E2E 설정.
// - Vite dev 서버를 자동 기동(6173)하고 Chromium 에서 실행
// - 백엔드 호출은 page.route() 로 모킹 — workplace-api 미기동 상태에서도 실행 가능
// - 산출물: ../../test-results/e2e
export default defineConfig({
  testDir: './e2e',
  outputDir: '../../test-results/e2e',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : '80%',
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:6173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:6173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
