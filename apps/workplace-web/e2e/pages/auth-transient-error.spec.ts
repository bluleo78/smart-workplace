// 앱을 열 때 세션 확인이 일시 오류로 실패하는 경우(WP-859) — 배포 중 게이트웨이 502·서버 일시 500·네트워크 끊김.
// 예전엔 실패 종류를 가리지 않고 세션 표시(hasSession)를 지우고 로그인 화면으로 보내, 서버가 돌아와도 다시 로그인해야 했다.
// 일시 오류는 세션을 남기고 「서버에 연결하지 못했습니다」+다시 시도를 보이며, 다시 시도하면 그대로 들어간다.
// 401(진짜 만료)은 지금처럼 로그인으로 — 판정 경우의 수는 client·ProtectedRoute 단위 테스트가 맡는다.
import { createTokenResponse } from '../factories/auth.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('세션 확인 일시 실패 (WP-859)', () => {
  test('refresh 가 502 면 로그인으로 가지 않고 세션을 남긴 채 다시 시도를 보인다 — 서버가 돌아오면 다시 시도로 들어간다', async ({ authenticatedPage: page }) => {
    let failing = true
    await page.route(
      (url) => url.pathname === '/api/v1/auth/refresh',
      (route) =>
        failing
          ? route.fulfill({ status: 502, contentType: 'text/html', body: 'Bad Gateway' })
          : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createTokenResponse()) }),
    )

    await page.goto('/')

    await expect(page.getByTestId('auth-connection-error')).toContainText('서버에 연결하지 못했습니다')
    await expect(page).not.toHaveURL(/\/login/)
    expect(await page.evaluate(() => localStorage.getItem('hasSession'))).not.toBeNull()

    failing = false
    await page.getByTestId('auth-connection-retry').click()
    await expect(page.getByTestId('auth-connection-error')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /사용자 메뉴/ })).toBeVisible()
  })

  test('/users/me 가 500 이어도 같은 안내 — 로그인 화면으로 가지 않는다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users/me', { message: '서버 오류' }, { status: 500 })

    await page.goto('/')

    await expect(page.getByTestId('auth-connection-error')).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
    expect(await page.evaluate(() => localStorage.getItem('hasSession'))).not.toBeNull()
  })

  test('refresh 가 401(만료)이면 지금처럼 세션을 지우고 로그인으로 간다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: false })
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
    await mockApi(page, 'POST', '/api/v1/auth/refresh', { message: '만료' }, { status: 401 })

    await page.goto('/')

    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByTestId('auth-connection-error')).toHaveCount(0)
  })
})
