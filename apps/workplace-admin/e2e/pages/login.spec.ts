import {
  createPlatformUser,
  expect,
  setupPlatformAuthMocks,
  test,
} from '../fixtures/platform-auth.fixture'

// 운영자 콘솔 로그인 E2E.
test.describe('운영자 로그인', () => {
  // (a) 폼 제출(login/me 목) → / 의 admin-home 표시
  test('로그인 성공 시 홈으로 진입한다', async ({ page }) => {
    await setupPlatformAuthMocks(page, createPlatformUser())
    await page.goto('/login')

    await page.getByTestId('login-username').fill('operator')
    await page.getByTestId('login-password').fill('password')
    await page.getByTestId('login-submit').click()

    await expect(page.getByTestId('admin-home')).toBeVisible()
  })

  // (a-2) 로그인 화면 타이틀 — 'Platform' 배지 + '플랫폼 콘솔'(주인공) + 'Smart Workplace'(브랜드 보조).
  // 고객 포탈(Smart Workplace 로그인)과 구분되는 플랫폼 전용 표기인지 검증.
  test('로그인 화면이 플랫폼 콘솔 타이틀로 표기된다', async ({ page }) => {
    await setupPlatformAuthMocks(page)
    await page.goto('/login')

    await expect(page.getByTestId('login-platform-badge')).toBeVisible()
    await expect(page.getByText('플랫폼 콘솔')).toBeVisible()
    await expect(page.getByText('Smart Workplace')).toBeVisible()
    // 한 줄 혼합("Smart Workplace 운영자 콘솔")이 제거됐는지 회귀 가드.
    await expect(page.getByText('Smart Workplace 운영자 콘솔')).toHaveCount(0)
  })

  // (b) login 403 → "운영자 권한이 없습니다." 표시, 미인증 유지
  test('운영자 권한이 없으면 에러를 표시한다', async ({ page }) => {
    await setupPlatformAuthMocks(page)
    // 구체 라우트(나중 등록)로 login 을 403 으로 오버라이드.
    await page.route('**/api/platform/auth/login', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ status: 403, error: 'Forbidden', message: 'not operator' }),
      }),
    )
    await page.goto('/login')

    await page.getByTestId('login-username').fill('user')
    await page.getByTestId('login-password').fill('password')
    await page.getByTestId('login-submit').click()

    await expect(page.getByTestId('login-error')).toHaveText('운영자 권한이 없습니다.')
    // 미인증 유지 — 여전히 로그인 폼이 보인다.
    await expect(page.getByTestId('login-submit')).toBeVisible()
  })

  // (c) hasSession 없이 / 접근 → /login 리다이렉트
  test('미인증 상태로 보호 라우트 접근 시 로그인으로 리다이렉트한다', async ({ page }) => {
    await setupPlatformAuthMocks(page)
    await page.goto('/')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByTestId('login-submit')).toBeVisible()
  })

  // (d) authenticatedPage(목+hasSession) 로 / → 세션 복원 후 admin-home
  test('세션이 있으면 새로고침 시 복원된다', async ({ authenticatedPage }) => {
    await authenticatedPage.goto('/')
    await expect(authenticatedPage.getByTestId('admin-home')).toBeVisible()
  })
})
