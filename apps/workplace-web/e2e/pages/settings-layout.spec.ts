import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('@smoke 설정 레이아웃 일관성', () => {
  test('프로필 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const header = page.getByTestId('page-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('프로필')
  })
  test('AI 비서 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/assistant')
    await expect(page.getByTestId('page-header')).toContainText('비서 설정')
  })
  test('메일 설정 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/mail')
    await expect(page.getByTestId('page-header')).toContainText('메일 설정')
  })
  test('API 토큰 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users/me/api-tokens', [])
    await page.goto('/settings/tokens')
    await expect(page.getByTestId('page-header')).toContainText('API 토큰')
  })

  // 구성원 관리 — SettingsPage 전환 후 PageHeader + 액션 버튼 검증
  test('구성원 페이지가 공용 PageHeader + 액션을 렌더한다', async ({ adminPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
    await page.goto('/settings/users')
    await expect(page.getByTestId('page-header')).toContainText('구성원')
    // 액션 버튼이 PageHeader 로 이동해도 동일 testid 로 노출
    await expect(page.getByTestId('add-member-button')).toBeVisible()
  })
})
