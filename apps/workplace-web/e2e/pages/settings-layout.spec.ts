import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('@smoke 설정 레이아웃 일관성', () => {
  test('프로필 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const header = page.getByTestId('page-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('프로필')
  })
  // 페이지 제목은 사이드바 메뉴 라벨과 동일해야 한다(#651)
  test('AI 비서 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/assistant')
    await expect(page.getByTestId('page-header')).toContainText('AI 비서')
  })
  test('메일 계정 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/mail')
    await expect(page.getByTestId('page-header')).toContainText('메일 계정')
  })
  test('API 토큰 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users/me/api-tokens', [])
    await page.goto('/settings/tokens')
    await expect(page.getByTestId('page-header')).toContainText('API 토큰')
  })
  // API 토큰 — 다른 폼형 설정 페이지와 동일한 Card 섹션 구조(#651)
  test('API 토큰 페이지가 Card 섹션(발급/목록)으로 구성된다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users/me/api-tokens', [])
    await page.goto('/settings/tokens')
    await expect(page.getByText('토큰 발급', { exact: true })).toBeVisible()
    await expect(page.getByText('발급된 토큰', { exact: true })).toBeVisible()
    await expect(page.getByTestId('token-issue-form')).toBeVisible()
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
