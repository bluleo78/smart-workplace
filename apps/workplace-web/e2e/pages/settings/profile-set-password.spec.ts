// WP-48 SSO 전용 계정의 프로필 — "비밀번호 설정" 카드(현재 비밀번호 없음).
import { mockApi } from '../../fixtures/api-mock'
import { createUser } from '../../factories/auth.factory'
import { expect, test } from '../../fixtures/auth.fixture'

test('비밀번호 없는 계정은 새 비밀번호만으로 설정한다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser(), hasPassword: false, roles: [] })
  const put = await mockApi(page, 'PUT', '/api/v1/users/me/password', null, { status: 204, capture: true })
  await page.goto('/settings/profile')
  await expect(page.getByText('비밀번호 설정', { exact: true }).first()).toBeVisible()
  await expect(page.locator('#current-password')).toHaveCount(0)
  await page.locator('#set-new-password').fill('Password123')
  await page.locator('#set-confirm-password').fill('Password123')
  await page.getByRole('button', { name: '비밀번호 설정' }).click()
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ newPassword: 'Password123' })
})

test('비밀번호가 있는 계정은 기존 변경 카드', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser(), hasPassword: true, roles: [] })
  await page.goto('/settings/profile')
  await expect(page.locator('#current-password')).toBeVisible()
})
