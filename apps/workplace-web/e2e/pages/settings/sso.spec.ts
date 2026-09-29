// WP-48 설정 › SSO — 토글, 운영자 미설정 비활성, 동의 링크 복사, 끌 때 SSO 전용 구성원 확인.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const settings = (over: Record<string, unknown> = {}) => ({
  available: true,
  enabled: false,
  adminConsentUrl: 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=abc',
  passwordlessMemberCount: 0,
  ...over,
})

test('사이드바에서 SSO 로 이동하고 켠다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings())
  const put = await mockApi(page, 'PUT', '/api/v1/admin/sso/enabled', null, { status: 204, capture: true })
  await page.goto('/settings/profile')
  await page.getByTestId('settings-admin-group').getByRole('link', { name: 'SSO' }).click()
  await expect(page).toHaveURL(/\/settings\/sso$/)
  await page.getByRole('switch', { name: 'SSO 로그인 사용' }).click()
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ enabled: true })
})

test('운영자 미설정이면 토글이 비활성이고 안내가 보인다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings({ available: false, adminConsentUrl: null }))
  await page.goto('/settings/sso')
  await expect(page.getByRole('switch', { name: 'SSO 로그인 사용' })).toBeDisabled()
  await expect(page.getByText('SSO 를 사용하려면 운영자 설정이 필요합니다.')).toBeVisible()
})

test('운영자 설정이 사라져도 켜져 있으면 끌 수 있다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings({ available: false, enabled: true, adminConsentUrl: null }))
  const put = await mockApi(page, 'PUT', '/api/v1/admin/sso/enabled', null, { status: 204, capture: true })
  await page.goto('/settings/sso')
  const toggle = page.getByRole('switch', { name: 'SSO 로그인 사용' })
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ enabled: false })
})

test('동의 링크를 복사한다', async ({ adminPage: page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings())
  await page.goto('/settings/sso')
  await page.getByRole('button', { name: '복사' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('adminconsent')
})

test('끌 때 SSO 전용 구성원이 있으면 확인한다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings({ enabled: true, passwordlessMemberCount: 3 }))
  const put = await mockApi(page, 'PUT', '/api/v1/admin/sso/enabled', null, { status: 204, capture: true })
  await page.goto('/settings/sso')
  await page.getByRole('switch', { name: 'SSO 로그인 사용' }).click()
  await expect(page.getByText('비밀번호가 없는 SSO 전용 구성원 3명이 로그인할 수 없게 됩니다. 계속하시겠습니까?')).toBeVisible()
  expect(put.requests).toHaveLength(0)
  await page.getByRole('button', { name: '끄기' }).click()
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ enabled: false })
})

test('SSO 전용 구성원이 없으면 확인 없이 끈다', async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings({ enabled: true }))
  const put = await mockApi(page, 'PUT', '/api/v1/admin/sso/enabled', null, { status: 204, capture: true })
  await page.goto('/settings/sso')
  await page.getByRole('switch', { name: 'SSO 로그인 사용' }).click()
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ enabled: false })
})
