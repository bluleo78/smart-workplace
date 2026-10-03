// 모바일 뒤로가기 히스토리 — 관리자 에이전트 상세 시트(?agent)(WP-209).
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/mobile.fixture'

// 실데이터 폭 검증용 긴 이름.
const AGENT = {
  id: 100,
  username: 'release_coordinator_bot',
  name: '릴리스 일정 조율 및 배포 체크리스트 자동 점검 에이전트',
  email: 'release@bot.local',
  kind: 'AGENT' as const,
  isActive: true,
  createdAt: '2026-05-20T09:00:00Z',
}

async function stubAgents(page: Page) {
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [AGENT] }) : r.fallback())
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (r) =>
    r.fulfill({ status: 404, json: { message: '없음' } }))
  await page.route('**/api/v1/admin/workspace-assistant', (r) =>
    r.fulfill({ json: { agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null } }))
}

test('행 → 시트: goBack 은 시트만 닫고 에이전트 관리에 남는다 — ESC 도 같은 결과', async ({ adminPage: page }) => {
  await stubAgents(page)
  await page.goto('/settings/agents')
  await page.getByTestId('agent-row-100').tap()
  const drawer = page.getByTestId('agent-detail-drawer')
  await expect(drawer).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/agents\?agent=100$/)

  await page.goBack()
  await expect(page).toHaveURL(/\/settings\/agents$/)
  await expect(drawer).toHaveCount(0)

  await page.getByTestId('agent-row-100').tap()
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/settings\/agents$/)
  await expect(drawer).toHaveCount(0)
})

test('딥링크(?agent) → 닫기는 에이전트 관리에 남는다', async ({ adminPage: page }) => {
  await stubAgents(page)
  await page.goto('/settings/agents?agent=100')
  await expect(page.getByTestId('agent-detail-drawer')).toBeVisible()
  await page.getByTestId('agent-detail-drawer').getByRole('button', { name: 'Close' }).tap()
  await expect(page).toHaveURL(/\/settings\/agents$/)
})

test('없는 에이전트 딥링크는 찾을 수 없음 시트를 보이고 닫힌다', async ({ adminPage: page }) => {
  await stubAgents(page)
  await page.goto('/settings/agents?agent=999')
  await expect(page.getByTestId('agent-detail-notfound')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/settings\/agents$/)
})
