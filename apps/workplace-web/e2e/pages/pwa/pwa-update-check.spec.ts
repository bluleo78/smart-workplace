// e2e/pages/pwa/pwa-update-check.spec.ts
// 열려 있는 앱의 새 버전 감지(WP-226) — 화면에 다시 보일 때 서비스워커 update() 를 호출하는지.
// 실제 새 배포는 E2E 에서 만들 수 없으므로, update 호출 횟수를 세어 앱이 확인을 거는지까지만 검증한다
// (호출 이후 새 SW 설치·토스트는 브라우저·vite-plugin-pwa 동작).
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
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // 백그라운드 → 다시 보임 전환을 흉내 낸다(headless 는 실제 탭 전환이 없으므로 visibilityState 를 덮어쓴다).
    // 등록 콜백(onRegisteredSW)이 리스너를 거는 시점이 SW ready 보다 늦을 수 있어, 호출이 잡힐 때까지 이벤트를 다시 보낸다
    // (쿨다운 덕에 반복 전송해도 실제 update 는 한 번).
    await expect
      .poll(() =>
        page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
          document.dispatchEvent(new Event('visibilitychange'))
          return (window as unknown as { __swUpdateCalls: number }).__swUpdateCalls
        }),
      )
      .toBeGreaterThan(0)
  })
})
