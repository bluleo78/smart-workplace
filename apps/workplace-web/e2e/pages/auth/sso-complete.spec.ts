// WP-48 SSO 완료 라우트 — refresh 로 세션을 받고 returnTo 로 진입하는 배선 1건만 남긴다.
// 여러 워크스페이스 선택 카드·워크스페이스 없음 안내·refresh 실패 시 로그인 복귀는 화면 테스트 src/pages/publicRoutes.test.tsx 가 지킨다(WP-971).
import { mockApi } from '../../fixtures/api-mock'
import { createTokenResponse, createUser } from '../../factories/auth.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const WS = (id: number, name: string) => ({ tenantId: id, tenantName: name, tenantSlug: `ws-${id}` })

async function baseMocks(page: import('@playwright/test').Page, memberships: unknown[]) {
  await mockApi(page, 'POST', '/api/v1/auth/refresh', createTokenResponse())
  await mockApi(page, 'GET', '/api/v1/auth/memberships', memberships)
  await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser(), roles: [] })
  await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [] })
}

test('단일 워크스페이스면 returnTo 로 진입하고 세션 플래그를 남긴다', { tag: '@wiring' }, async ({ page }) => {
  await baseMocks(page, [WS(1, 'Acme')])
  await page.goto('/login/sso/complete?returnTo=%2Fsettings%2Fprofile')
  await expect(page).toHaveURL(/\/settings\/profile$/)
  expect(await page.evaluate(() => localStorage.getItem('hasSession'))).toBe('true')
})
