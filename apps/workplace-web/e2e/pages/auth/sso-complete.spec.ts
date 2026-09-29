// WP-48 SSO 완료 라우트 — refresh 로 세션을 받고 returnTo 또는 워크스페이스 선택으로.
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

test('단일 워크스페이스면 returnTo 로 진입하고 세션 플래그를 남긴다', async ({ page }) => {
  await baseMocks(page, [WS(1, 'Acme')])
  await page.goto('/login/sso/complete?returnTo=%2Fsettings%2Fprofile')
  await expect(page).toHaveURL(/\/settings\/profile$/)
  expect(await page.evaluate(() => localStorage.getItem('hasSession'))).toBe('true')
})

test('여러 워크스페이스면 선택 카드를 보여준다', async ({ page }) => {
  await baseMocks(page, [WS(1, 'Acme'), WS(2, 'Beta')])
  await page.goto('/login/sso/complete?returnTo=%2F')
  await expect(page.getByText('워크스페이스 선택')).toBeVisible()
  await expect(page.getByTestId('workspace-option-2')).toBeVisible()
})

test('워크스페이스가 없으면 안내한다', async ({ page }) => {
  await baseMocks(page, [])
  await page.goto('/login/sso/complete')
  await expect(page.getByText('접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.')).toBeVisible()
})

test('외부 returnTo 는 루트로 바꾼다', async ({ page }) => {
  await baseMocks(page, [WS(1, 'Acme')])
  await page.goto('/login/sso/complete?returnTo=%2F%2Fevil.com')
  await expect(page).toHaveURL(/\/$/)
})

test('refresh 실패면 로그인으로 되돌린다', async ({ page }) => {
  await mockApi(page, 'POST', '/api/v1/auth/refresh', { message: 'x' }, { status: 401 })
  // 실패 시 착지하는 로그인 페이지의 SSO 가용성 조회 스텁 — 누수 401 이 refresh 재시도 후 쿼리 없는 /login 으로 덮어쓰지 않게.
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
  await page.goto('/login/sso/complete')
  await expect(page).toHaveURL(/\/login\?sso_error=retry$/)
})
