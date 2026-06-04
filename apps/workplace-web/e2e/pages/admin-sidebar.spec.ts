// 관리 모듈 2차 사이드바 E2E — 항목 노출(AGENT 흡수 포함) + 비관리자 접근 차단.
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test('관리 모듈 2차 사이드바에 AGENT가 포함된다', { tag: '@smoke' }, async ({ adminPage: page }) => {
  // /settings/users 가 PageResponse<UserResponse> 를 소비하므로 빈 페이지 응답을 모킹한다.
  // mockApi 는 pathname 정확 매칭이라 /api/v1/users/me(인증 fixture) 를 침범하지 않는다.
  await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
  // AGENT 링크 클릭 후 착지하는 /settings/agents 가 throw 없이 렌더되도록 최소 모킹.
  // AgentManagementPage: useAgents() → 빈 배열, WorkspaceAssistantCard → 미지정 상태.
  await mockApi(page, 'GET', '/api/v1/admin/agents', [])
  await mockApi(page, 'GET', '/api/v1/admin/workspace-assistant', {
    agentUserId: null,
    agentName: null,
    hasActiveToken: false,
    model: null,
    thinkingDepth: null,
  })

  await page.goto('/settings/users')

  const sidebar = page.getByTestId('settings-sidebar')
  await expect(sidebar).toBeVisible()
  // 앱 타이틀 헤더("설정")로 현재 앱을 식별할 수 있다(Slack 모델)
  await expect(sidebar.getByText('설정', { exact: true })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'AGENT' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: '감사 로그' })).toBeVisible()

  // 클릭 → URL 네비게이션까지 검증 (요소 존재만 보면 안 됨 — 입력→처리→출력).
  await sidebar.getByRole('link', { name: 'AGENT' }).click()
  await expect(page).toHaveURL(/\/settings\/agents$/)
})

test('일반 사용자는 관리 사이드바에 접근할 수 없다', async ({ authenticatedPage: page }) => {
  // AdminRoute 가 비관리자를 "/" 로 리다이렉트하므로 설정 사이드바는 마운트되지 않는다.
  await page.goto('/settings/users')
  await expect(page.getByTestId('settings-sidebar')).toHaveCount(0)
})
