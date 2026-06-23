// 사이드바 프로젝트 네비 진입로 E2E — 1급 항목 클릭 및 생성 다이얼로그 트리거 검증.
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { createProject } from '../../factories/project.factory'

test.beforeEach(async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '**/api/v1/projects**', createPageResponse([createProject({ key: 'EX', name: '예제', type: 'TEAM' })]))
})

test('사이드바 상단 "프로젝트" 클릭 → /projects', async ({ authenticatedPage: page }) => {
  await page.goto('/me/tasks')
  await page.getByTestId('sidebar-all-projects').click()
  await expect(page).toHaveURL(/\/projects$/)
})

test('"프로젝트" 섹션 + 클릭 → 생성 다이얼로그', async ({ authenticatedPage: page }) => {
  await page.goto('/projects')
  await page.getByTestId('sidebar-create-project').click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
