// e2e/pages/pwa/pwa-update-check.spec.ts
// 열려 있는 앱의 새 버전 감지(WP-226) — 화면에 다시 보일 때 서비스워커 update() 를 호출하는지.
// 실제 새 배포는 E2E 에서 만들 수 없으므로, update 호출 횟수를 세어 앱이 확인을 거는지까지만 검증한다
// (호출 이후 새 SW 설치·토스트는 브라우저·vite-plugin-pwa 동작).
import { UPDATE_CHECK_COOLDOWN_MS } from '@/lib/pwa/updateCheck'

import { expect, test } from '../../fixtures/auth.fixture'

test.use({ serviceWorkers: 'allow' })

test.describe('PWA 업데이트 확인', () => {
  test('앱이 다시 화면에 보이면 서비스워커 업데이트를 확인한다', async ({ authenticatedPage: page }) => {
    // 페이지 스크립트보다 먼저 update 를 감싸 호출 횟수를 센다.
    await page.addInitScript(() => {
      const w = window as unknown as { __swUpdateCalls: number }
      w.__swUpdateCalls = 0
      const original = ServiceWorkerRegistration.prototype.update
      ServiceWorkerRegistration.prototype.update = function (this: ServiceWorkerRegistration) {
        w.__swUpdateCalls += 1
        return original.call(this)
      }
    })
    // 로드 직후 쿨다운(브라우저가 방금 sw.js 를 확인함)을 시간 경과로 넘기기 위해 가짜 시계를 쓴다.
    await page.clock.install()
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // 백그라운드 → 다시 보임 전환을 흉내 낸다(headless 는 실제 탭 전환이 없으므로 visibilityState 를 덮어쓴다).
    // 등록 콜백(onRegisteredSW)이 리스너를 걸고 쿨다운을 시작하는 시점이 SW ready 보다 늦을 수 있어,
    // 호출이 잡힐 때까지 매번 쿨다운만큼 시간을 넘기고 이벤트를 다시 보낸다.
    await expect
      .poll(async () => {
        await page.clock.fastForward(UPDATE_CHECK_COOLDOWN_MS)
        return page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
          document.dispatchEvent(new Event('visibilitychange'))
          return (window as unknown as { __swUpdateCalls: number }).__swUpdateCalls
        })
      })
      .toBeGreaterThan(0)
  })
})
