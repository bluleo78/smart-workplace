// WP-48 로그인 화면의 Microsoft 로그인 버튼과 SSO 오류/안내 배너.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('Microsoft 로그인', () => {
  test('SSO 가 설정되면 버튼이 보이고 start 로 이동한다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
    let startedWith: string | null = null
    await page.route(
      (url) => url.pathname === '/api/v1/auth/sso/start',
      (route) => {
        startedWith = new URL(route.request().url()).searchParams.get('returnTo')
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>microsoft</p>' })
      },
    )
    await page.goto('/login')
    await page.getByRole('link', { name: 'Microsoft 계정으로 로그인' }).click()
    await expect.poll(() => startedWith).toBe('/')
  })

  test('SSO 미설정이면 버튼을 숨긴다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '로그인' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Microsoft 계정으로 로그인' })).toHaveCount(0)
  })

  for (const [code, text] of [
    ['denied', '등록되지 않은 Microsoft 계정입니다. 관리자에게 등록을 요청하세요.'],
    ['consent', '조직 관리자의 앱 승인이 필요합니다.'],
    ['retry', '로그인 처리 중 문제가 발생했습니다. 다시 시도해 주세요.'],
  ] as const) {
    test(`sso_error=${code} 배너`, async ({ page }) => {
      await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
      await page.goto(`/login?sso_error=${code}`)
      await expect(page.getByRole('alert')).toHaveText(text)
    })
  }

  test('알 수 없는 오류 코드는 배너를 띄우지 않는다', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
    await page.goto('/login?sso_error=unavailable')
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('관리자 동의 완료 안내', async ({ page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: true })
    await page.goto('/login?sso_notice=consented')
    await expect(page.getByRole('status')).toHaveText('관리자 승인이 완료되었습니다.')
  })
})
