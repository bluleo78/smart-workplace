// 로그인 폼이 비-이메일 아이디(예: 'jane')를 수용하는지 — 아이디/이메일 분리 지원의 전제.
import { mockApi } from '../fixtures/api-mock'
import { createTokenResponse } from '../factories/auth.factory'
import { expect, test } from '../fixtures/auth.fixture'

test('비-이메일 아이디로 로그인 제출이 가능하다', async ({ page }) => {
  // login 응답 모킹 — 폼 제출이 /api/v1/auth/login 으로 payload 를 보내는지 검증.
  let captured: unknown = null
  await page.route(
    (url) => url.pathname === '/api/v1/auth/login',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      captured = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createTokenResponse()),
      })
    },
  )
  await mockApi(page, 'POST', '/api/v1/auth/refresh', createTokenResponse())

  await page.goto('/login')
  await page.getByLabel('아이디').fill('jane')
  await page.locator('#password').fill('Password123')
  await page.getByRole('button', { name: '로그인' }).click()

  // 입력→payload: zod 가 'jane' 을 막지 않고 그대로 전송돼야 한다.
  await expect.poll(() => captured).toMatchObject({ username: 'jane' })
})
