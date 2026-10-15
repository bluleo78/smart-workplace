// WP-48 로그인 화면의 Microsoft 로그인 버튼과 SSO 오류/안내 배너.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

test.describe('Microsoft 로그인', () => {
  test('SSO 가 설정되면 버튼이 보이고 start 로 이동한다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
    const starts = trackRequests(page, 'ANY', '/api/v1/auth/sso/start')
    await page.route(
      (url) => url.pathname === '/api/v1/auth/sso/start',
      (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>microsoft</p>' }),
    )
    await page.goto('/login')
    await page.getByRole('link', { name: 'Microsoft 계정으로 로그인' }).click()
    await expect.poll(() => starts.lastUrl()?.searchParams.get('returnTo')).toBe('/')
  })

  test('SSO 미설정이면 버튼을 숨긴다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Microsoft 계정으로 로그인' })).toHaveCount(0)
  })

  // 코드별 문구(consent·retry)와 모르는 코드 무시는 sso.test(ssoErrorMessage)가 지킨다 — 여기선 URL → 배너 배선 한 번.
  test('sso_error=denied 배너', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
    await page.goto('/login?sso_error=denied')
    await expect(page.getByRole('alert')).toHaveText('등록되지 않은 Microsoft 계정입니다. 관리자에게 등록을 요청하세요.')
  })

  test('관리자 동의 완료 안내', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
    await page.goto('/login?sso_notice=consented')
    await expect(page.getByRole('status')).toHaveText('관리자 승인이 완료되었습니다.')
  })
})
