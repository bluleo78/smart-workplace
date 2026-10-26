// WP-48 설정 › SSO — 사이드바에서 들어가 켜는 배선(@wiring)과 실제 클립보드 복사(@platform).
// 운영자 미설정 비활성·켜져 있으면 끄기·SSO 전용 구성원 확인·Clipboard API 없을 때 대체 복사/실패 안내(WP-836)는
// src/pages/admin/ssoSettings.test.tsx(화면 컴포넌트 테스트)가 지킨다.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const settings = (over: Record<string, unknown> = {}) => ({
  available: true,
  enabled: false,
  adminConsentUrl: 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=abc',
  passwordlessMemberCount: 0,
  ...over,
})

test('사이드바에서 SSO 로 이동하고 켠다', { tag: '@wiring' }, async ({ adminPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings())
  const put = await mockApi(page, 'PUT', '/api/v1/admin/sso/enabled', null, { status: 204, capture: true })
  await page.goto('/settings/profile')
  await page.getByTestId('settings-admin-group').getByRole('link', { name: 'SSO' }).click()
  await expect(page).toHaveURL(/\/settings\/sso$/)
  await page.getByRole('switch', { name: 'SSO 로그인 사용' }).click()
  await expect.poll(() => put.lastRequest()?.payload).toEqual({ enabled: true })
})

test('동의 링크를 복사한다', { tag: '@platform' }, async ({ adminPage: page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockApi(page, 'GET', '/api/v1/admin/sso', settings())
  await page.goto('/settings/sso')
  await page.getByRole('button', { name: '복사' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('adminconsent')
})
