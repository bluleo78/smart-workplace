// 앱을 열 때 세션 확인이 일시 오류로 실패하는 경우(WP-859) — 배포 중 게이트웨이 502·서버 일시 500·네트워크 끊김.
// 예전엔 실패 종류를 가리지 않고 세션 표시(hasSession)를 지우고 로그인 화면으로 보내, 서버가 돌아와도 다시 로그인해야 했다.
// 일시 오류는 세션을 남기고 「서버에 연결하지 못했습니다」+다시 시도를 보이며, 다시 시도하면 그대로 들어간다.
// 401(진짜 만료)은 지금처럼 로그인으로 — 판정 경우의 수는 client·ProtectedRoute 단위 테스트가 맡는다.
// /users/me 500 의 같은 안내·401 의 로그인 이동은 화면 컴포넌트 테스트 src/pages/authPages.test.tsx 가 지키고(WP-971),
// 여기에는 앱 부팅 → refresh 실패 → 안내 → 다시 시도로 들어가는 대표 배선(@wiring) 1건만 남긴다.
import { createTokenResponse } from '../factories/auth.factory'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('세션 확인 일시 실패 (WP-859)', { tag: '@wiring' }, () => {
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
})
