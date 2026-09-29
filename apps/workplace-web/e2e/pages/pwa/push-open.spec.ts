// e2e/pages/pwa/push-open.spec.ts
// 알림 탭 진입점 — 같은 테넌트 이동, 다른 테넌트 전환, 비멤버 거부, 외부 url 차단, 미로그인 후 복귀, 열린 창 postMessage 이동.
import { createMembership, createTokenResponse } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const T1 = createMembership({ tenantId: 1, tenantName: 'A', tenantSlug: 'a' })
const T2 = createMembership({ tenantId: 2, tenantName: 'B', tenantSlug: 'b' })

test.describe('/push-open', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.addInitScript((m) => localStorage.setItem('activeTenant', JSON.stringify(m)), T1)
    await mockApi(page, 'GET', '/api/v1/auth/memberships', [T1, T2])
  })

  test('같은 테넌트면 바로 이동', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=1&to=' + encodeURIComponent('/calendar?eventId=9'))
    await expect(page).toHaveURL(/\/calendar/)
  })

  test('다른 테넌트면 전환 후 이동', async ({ authenticatedPage: page }) => {
    const sel = await mockApi(page, 'POST', '/api/v1/auth/select-tenant', createTokenResponse(), { capture: true })
    await page.goto('/push-open?t=2&to=' + encodeURIComponent('/chat/dms/42'))
    const req = await sel.waitForRequest()
    expect(req.payload).toEqual({ tenantId: 2 })
    await expect(page).toHaveURL(/\/chat\/dms\/42$/)
  })

  test('소속되지 않은 테넌트면 안내 후 홈', async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=77&to=' + encodeURIComponent('/chat/dms/42'))
    await expect(page.getByText('해당 워크스페이스에 접근할 수 없습니다')).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('외부 url 은 홈으로', async ({ authenticatedPage: page }) => {
    await page.goto('/push-open?t=1&to=' + encodeURIComponent('//evil.com'))
    await expect(page).toHaveURL(/\/$/)
  })

  test('열린 창은 서비스워커 메시지로 이동', async ({ authenticatedPage: page }) => {
    await page.goto('/')
    await expect(page.getByTestId('app-rail')).toBeVisible()
    await page.evaluate(() =>
      navigator.serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'push-navigate', url: '/calendar', tenantId: 1 } }),
      ),
    )
    await expect(page).toHaveURL(/\/calendar$/)
  })

  test('대기 목적지는 앱 진입 시 소비된다', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() =>
      sessionStorage.setItem('pendingPushTarget', JSON.stringify({ tenantId: null, url: '/calendar' })),
    )
    await page.goto('/')
    await expect(page).toHaveURL(/\/calendar$/)
    expect(await page.evaluate(() => sessionStorage.getItem('pendingPushTarget'))).toBeNull()
  })
})

test('미로그인 → 로그인 후 목적지', async ({ page }) => {
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  await page.goto('/push-open?t=1&to=' + encodeURIComponent('/calendar'))
  await expect(page).toHaveURL(/\/login$/)
  const pending = await page.evaluate(() => sessionStorage.getItem('pendingPushTarget'))
  expect(JSON.parse(pending!)).toEqual({ tenantId: 1, url: '/calendar' })
})
