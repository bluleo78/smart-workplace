import { expect, setupPlatformAuthMocks, test } from '../fixtures/platform-auth.fixture'

// 사용자 메뉴 맨 아래 앱 버전 표기 (WP-439).
// playwright.config.ts 의 webServer env(APP_VERSION=0.9.0, GIT_SHA=a5d66d0e1234)로 빌드 상수가 주입된다.
test.describe('운영자 콘솔 앱 버전', () => {
  test('사용자 메뉴 맨 아래에 버전이 보이고 title 에 커밋 7자가 담긴다', async ({ page }) => {
    await setupPlatformAuthMocks(page)
    await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
    await page.goto('/')
    await page.getByTestId('admin-user-menu').click()

    const version = page.getByTestId('admin-version')
    await expect(version).toHaveText('v0.9.0')
    await expect(version).toHaveAttribute('title', 'a5d66d0')
    // 새 소식·링크 없이 표기만 — 메뉴 항목이 아니다
    await expect(version.locator('a')).toHaveCount(0)
  })
})
