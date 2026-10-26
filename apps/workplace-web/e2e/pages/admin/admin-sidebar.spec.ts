// 관리 모듈 2차 사이드바 E2E — 설정 화면에 사이드바가 붙고 링크로 에이전트 화면에 들어가는 배선(@wiring).
// 워크스페이스 관리 항목 순서는 src/pages/admin/userList.test.tsx(renderScreen) 가 지킨다(WP-966).
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test('관리 모듈 2차 사이드바에 AGENT가 포함된다', { tag: ['@wiring', '@smoke'] }, async ({ adminPage: page }) => {
  // /settings/users 가 PageResponse<MemberSummary>(구성원 디렉터리, #833) 를 소비하므로 빈 페이지 응답을 모킹한다.
  await mockApi(page, 'GET', '/api/v1/members', createPageResponse([]))
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
  await expect(sidebar.getByRole('link', { name: '에이전트' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: '감사 로그' })).toBeVisible()

  // 클릭 → URL 네비게이션까지 검증 (요소 존재만 보면 안 됨 — 입력→처리→출력).
  await sidebar.getByRole('link', { name: '에이전트' }).click()
  await expect(page).toHaveURL(/\/settings\/agents$/)
})

// 비관리자의 /settings/users 접근 차단(홈 리다이렉트)은 settings/settings-nav.spec.ts 가 맡는다.
