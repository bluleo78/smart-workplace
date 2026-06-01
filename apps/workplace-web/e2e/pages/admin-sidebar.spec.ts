// 관리 모듈 2차 사이드바 E2E — 항목 노출(AGENT 흡수 포함) + 비관리자 접근 차단.
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test('관리 모듈 2차 사이드바에 AGENT가 포함된다', { tag: '@smoke' }, async ({ adminPage: page }) => {
  // /admin/users 가 PageResponse<UserResponse> 를 소비하므로 빈 페이지 응답을 모킹한다.
  // mockApi 는 pathname 정확 매칭이라 /api/v1/users/me(인증 fixture) 를 침범하지 않는다.
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))

  await page.goto('/admin/users')

  const sidebar = page.getByTestId('admin-sidebar')
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'AGENT' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: '감사 로그' })).toBeVisible()
})

test('일반 사용자는 관리 사이드바에 접근할 수 없다', async ({ authenticatedPage: page }) => {
  // AdminRoute 가 비관리자를 "/" 로 리다이렉트하므로 사이드바는 마운트되지 않는다.
  await page.goto('/admin/users')
  await expect(page.getByTestId('admin-sidebar')).toHaveCount(0)
})
