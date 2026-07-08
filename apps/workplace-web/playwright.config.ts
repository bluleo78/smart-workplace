import { defineConfig, devices } from '@playwright/test'

const CI = !!process.env.CI

// E2E 전용 포트.
// - CI: 단일 러너이므로 고정 6173.
// - 로컬: 병렬 Claude 세션이 각자 E2E/pre-commit 을 돌려도 같은 dev 서버를 물지 않도록
//   런마다 고유 포트로 격리한다(20000~29999, 앱 포트 6060/6070/6080/6090/6173/6174 회피).
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
  // 병렬 세션 간 실행 직렬화(워커 오버서브스크립션 방지) — e2e/global-lock.ts 참조.
  globalSetup: './e2e/global-lock.ts',

  fullyParallel: true,
  forbidOnly: CI,
  // 로컬 1회 재시도 = 게이트 안전망. 근본 원인은 위/아래 fix 로 잡되, 남은 롱테일 플래키(예:
  // report 의 8도메인 산발 1/100)가 커밋을 막지 않게 한다. 재시도 통과도 'flaky' 로 보고되어
  // 은폐가 아니라 가시화된다(원인 수정을 대체하지 않고 게이트에만 얹는 그물).
  retries: CI ? 2 : 1,
  // 단일 Vite 서버가 병목이라 워커를 더 늘려도 throughput 은 안 오르고 큐 지연만 커진다
  // (8워커 유효 병렬도 5.3x). 동시성을 낮춰 지연 스파이크 → 플래키를 줄인다(10코어 기준 5개).
  workers: CI ? 1 : '50%',
  reporter: 'html',

  // 단언 기본 타임아웃 5초는 서버 부하 시 lazy 라우트 트랜스폼 지연(간헐 5~8초)에 걸려
  // 비결정적 실패를 낸다. 10초로 올려 통과 경로 속도엔 영향 없이 지연 스파이크를 흡수한다.
  expect: { timeout: 10_000 },

  use: {
    baseURL: HOST,
    // 액션(클릭 등)도 부하 시 지연/일시적 오버레이를 넘기도록 재시도 창을 넓힌다.
    actionTimeout: 15_000,
    // on-first-retry + 로컬 retries:0 이면 trace 가 전혀 안 남아 플래키 디버그가 불가능했다.
    // 실패 시 항상 trace 보존으로 변경(다음 플래키부터 원인 추적 가능).
    trace: 'retain-on-failure',
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
    // E2E 는 백엔드 없이 page.route() 모킹으로 동작 → 프록시 콜드스타트 대기를 끄도록 신호를 내린다.
    env: { E2E: '1' },
    url: HOST,
    // 병렬 세션 격리를 위해 로컬에서도 기존 서버 재사용 금지(매 런 자체 서버 기동).
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
