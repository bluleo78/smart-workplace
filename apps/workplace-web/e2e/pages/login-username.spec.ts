// 로그인 폼이 비-이메일 아이디(예: 'jane')를 수용하는지 — 아이디/이메일 분리 지원의 전제.
import { mockApi } from '../fixtures/api-mock'
import { createTokenResponse } from '../factories/auth.factory'
import { expect, test } from '../fixtures/auth.fixture'
import { trackRequests } from '../fixtures/requests'

test('비-이메일 아이디로 로그인 제출이 가능하다', async ({ page }) => {
  // login 응답 모킹 — 폼 제출이 /api/v1/auth/login 으로 payload 를 보내는지 검증.
  const logins = trackRequests(page, 'POST', '/api/v1/auth/login')
  await page.route(
    (url) => url.pathname === '/api/v1/auth/login',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createTokenResponse()),
      })
    },
  )
  await mockApi(page, 'POST', '/api/v1/auth/refresh', createTokenResponse())
  // WP-48 — 로그인 페이지가 마운트 시 SSO 가용성(/auth/sso/status)도 조회한다. 미스텁 시 로컬 백엔드로 누수돼 401 → refresh 실패 → /login 강제 이동으로 테스트가 깨진다.
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })

  await page.goto('/login')
  await page.getByLabel('아이디').fill('jane')
  await page.locator('#password').fill('Password123')
  await page.getByRole('button', { name: '로그인' }).click()

  // 입력→payload: zod 가 'jane' 을 막지 않고 그대로 전송돼야 한다.
  await expect.poll(() => logins.lastBody()).toMatchObject({ username: 'jane' })
})

// WP-763 — 같은 IP 에서 로그인이 몰려 서버가 429 로 거절하면, 비밀번호 오류 문구가 아니라 서버의 「요청이 너무 많습니다」 안내를 보인다.
test('로그인이 속도 제한(429)에 걸리면 서버 안내를 그대로 보인다', async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/api/v1/auth/login',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        headers: { 'Retry-After': '3' },
        body: JSON.stringify({
          status: 429,
          error: 'Too Many Requests',
          message: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.',
          errors: null,
          timestamp: new Date().toISOString(),
          path: '/api/v1/auth/login',
        }),
      })
    },
  )
  await mockApi(page, 'POST', '/api/v1/auth/refresh', createTokenResponse())
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })

  await page.goto('/login')
  await page.getByLabel('아이디').fill('jane')
  await page.locator('#password').fill('Password123')
  await page.getByRole('button', { name: '로그인' }).click()

  await expect(page.getByText('요청이 너무 많습니다. 잠시 후 다시 시도하세요.')).toBeVisible()
  await expect(page.getByText('아이디 또는 비밀번호가 올바르지 않습니다.')).toHaveCount(0)
})
