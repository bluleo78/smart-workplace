// e2e/pages/pwa/push-open.spec.ts
// 알림 탭 진입점 — 같은 테넌트 이동 배선(@wiring)과 열린 창의 서비스워커 메시지 이동(@platform)만 남긴다.
// 다른 테넌트 전환(select-tenant payload·목적지)·비멤버 거부·외부 url 차단·미로그인 목적지 보관은 화면 테스트 src/pages/publicRoutes.test.tsx,
// 로그인 뒤 대기 목적지 소비는 페이지 테스트 src/pages/authSession.test.tsx 가 지킨다(WP-971).
import { createMembership } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const T1 = createMembership({ tenantId: 1, tenantName: 'A', tenantSlug: 'a' })
const T2 = createMembership({ tenantId: 2, tenantName: 'B', tenantSlug: 'b' })

test.describe('/push-open', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.addInitScript((m) => localStorage.setItem('activeTenant', JSON.stringify(m)), T1)
    await mockApi(page, 'GET', '/api/v1/auth/memberships', [T1, T2])
  })

  test('같은 테넌트면 바로 이동', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=1&to=' + encodeURIComponent('/calendar?eventId=9'))
    await expect(page).toHaveURL(/\/calendar/)
  })

  test('열린 창은 서비스워커 메시지로 이동', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await page.goto('/')
    await expect(page.getByTestId('app-rail')).toBeVisible()
    await page.evaluate(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'push-navigate', url: '/calendar', tenantId: 1 } }),
      ),
    )
    await expect(page).toHaveURL(/\/calendar$/)
  })
})
