import { expect, test } from '@playwright/test'

// 스캐폴딩 스모크 — 앱이 뜨는지 확인.
// 인증 도입(Task 2) 이후 "/" 는 미인증 시 /login 으로 리다이렉트되므로 로그인 폼을 확인한다.
test('renders login form when unauthenticated', async ({ page }) => {
  // 미스텁 백엔드 누수 방지: pathname 이 /api/ 로 시작하는 호출 즉시 404.
  // (`**/api/**` 글롭은 vite 소스 모듈 `/src/api/*` 까지 잡으므로 pathname predicate 사용)
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  )
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-submit')).toBeVisible()
})
