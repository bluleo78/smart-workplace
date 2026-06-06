import { expect, test } from '../fixtures/auth.fixture'

// 프로필 개인 비서 섹션 E2E — 미설정 상태에서 토큰을 등록하면 "설정됨" 으로 전환된다.
// 백엔드 없이 GET 상태/PUT 토큰을 page.route 로 모킹. PUT 후 GET 응답을 configured=true 로 바꿔
// 캐시 무효화 → 재조회 → UI 반영을 검증한다.

test.describe('프로필 개인 비서', () => {
  test('미설정 → 토큰 등록 → 설정됨', async ({ authenticatedPage: page }) => {
    let configured = false

    // GET /users/me/assistant — configured 플래그에 따라 미설정/설정됨 응답.
    await page.route('**/api/v1/users/me/assistant', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            configured
              ? {
                  configured: true,
                  tokenLabel: null,
                  tokenLastUsedAt: null,
                  model: 'claude-sonnet-4-6',
                  thinkingDepth: 'NORMAL',
                }
              : {
                  configured: false,
                  tokenLabel: null,
                  tokenLastUsedAt: null,
                  model: null,
                  thinkingDepth: null,
                },
          ),
        })
      }
      return route.fallback()
    })

    // PUT /users/me/assistant/token — 등록 성공 시 이후 GET 이 설정됨을 반환하도록 플래그 전환.
    await page.route('**/api/v1/users/me/assistant/token', async (route) => {
      configured = true
      return route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/settings/assistant')

    // 미설정: 토큰 입력 → 등록.
    await page.getByTestId('assistant-token-input').fill('x'.repeat(40))
    await page.getByRole('button', { name: '토큰 등록' }).click()

    // 설정됨 표시가 노출되어야 한다.
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
  })

  test('비서 설정 페이지 제목', async ({ authenticatedPage: page }) => {
    // GET /users/me/assistant — 미설정 상태 모킹(컴포넌트 크래시 방지)
    await page.route('**/api/v1/users/me/assistant', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          configured: false,
          tokenLabel: null,
          tokenLastUsedAt: null,
          model: null,
          thinkingDepth: null,
        }),
      }),
    )
    await page.goto('/settings/assistant')
    await expect(page.getByRole('heading', { name: '비서 설정' })).toBeVisible()
  })
})
