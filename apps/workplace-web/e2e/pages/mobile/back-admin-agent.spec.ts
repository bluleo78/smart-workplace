// 모바일 뒤로가기 히스토리 — 관리자 에이전트 상세(WP-209). 상세는 시트(?agent)가 아닌 전체 페이지(/settings/agents/:id)가 됐다(WP-1281).
// 브라우저 뒤로가기(goBack)가 목록으로 돌아오는지(@platform)만 남긴다. 시트를 닫는 ESC 는 시트와 함께 없어졌다.
// 없는 에이전트 안내는 페이지 테스트가 지킨다(WP-971).
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/mobile.fixture'
import { mockAgentDetail, mockAgentRuntimeNone } from '../../fixtures/agent-runtime-mock'

// 실데이터 폭 검증용 긴 이름.
const AGENT = {
  id: 100,
  username: 'release_coordinator_bot',
  name: '릴리스 일정 조율 및 배포 체크리스트 자동 점검 에이전트',
  email: 'release@bot.local',
  kind: 'AGENT' as const,
  isActive: true,
  createdAt: '2026-05-20T09:00:00Z',
  type: 'REGULAR' as const,
  ownerName: null,
  runtime: 'INTERNAL' as const,
  runMode: 'SERVER' as const,
  lastKeyUsedAt: null,
  description: null,
  instructions: null,
}

async function stubAgents(page: Page) {
  await mockAgentRuntimeNone(page)
  await mockAgentDetail(page, () => [AGENT as never])
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [AGENT] }) : r.fallback())
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (r) =>
    r.fulfill({ status: 404, json: { message: '없음' } }))
  await page.route('**/api/v1/admin/workspace-assistant', (r) =>
    r.fulfill({ json: { agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null } }))
}

test('행 → 상세 페이지: goBack 은 에이전트 목록으로 돌아온다', { tag: '@platform' }, async ({ adminPage: page }) => {
  await stubAgents(page)
  await page.goto('/settings/agents')
  await page.getByTestId('agent-row-100').tap()
  await expect(page.getByTestId('agent-detail-page')).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/agents\/100$/)

  await page.goBack()
  await expect(page).toHaveURL(/\/settings\/agents$/)
  await expect(page.getByTestId('agent-detail-page')).toHaveCount(0)
  await expect(page.getByTestId('agent-row-100')).toBeVisible()
})
