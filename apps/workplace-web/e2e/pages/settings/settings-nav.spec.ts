// 설정 앱 내비게이션 — 구 경로 리다이렉트 + 비어드민 게이팅.
// 인증은 auth.fixture 의 authenticatedPage(일반)/adminPage(어드민) 픽스처로 주입한다.
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('설정 앱 내비게이션', () => {
  test('구 /profile 은 /settings/profile 로 리다이렉트', async ({ authenticatedPage: page }) => {
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/settings\/profile$/)
  })

  test('구 /admin/users 는 /settings/users 로 리다이렉트(어드민)', async ({ adminPage: page }) => {
    // 착지 페이지(UserListPage)가 /api/v1/users 를 소비하므로 빈 페이지 응답을 모킹(프록시 누수 방지).
    await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/settings\/users$/)
  })

  test('비어드민에게는 설정 사이드바의 관리 그룹이 보이지 않는다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await expect(page.getByTestId('settings-sidebar')).toBeVisible()
    await expect(page.getByTestId('settings-admin-group')).toHaveCount(0)
  })

  test('비어드민이 /settings/users 직접 접근 시 차단(홈 리다이렉트)', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/users')
    await expect(page).toHaveURL(/\/$/)
  })
})
