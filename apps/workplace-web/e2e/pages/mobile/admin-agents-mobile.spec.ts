// WP-639: 관리자 설정 > 에이전트 표 — 휴대폰 폭에서 표가 가로로 넘치지 않고,
// 숨긴 열(아이디·유형·실행)은 이름 아래 한 줄로 보인다. 행을 누르면 상세 시트가 열린다.
import type { Page } from '@playwright/test'

import type { AgentResponse } from '../../../src/types/agent'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

// 실데이터 폭 검증용 긴 이름·긴 아이디
const AGENTS: AgentResponse[] = [
  {
    id: 100,
    username: 'release_coordinator_bot@iacloud.kr',
    email: null,
    name: '릴리스 일정 조율 및 배포 체크리스트 자동 점검 에이전트',
    isActive: true,
    createdAt: '2026-05-20T09:00:00Z',
    type: 'WORKSPACE',
    ownerName: null,
    runtime: 'EXTERNAL',
    description: null,
    instructions: null,
    lastKeyUsedAt: null,
  },
  {
    id: 101,
    username: 'assistant-kim@iacloud.kr',
    email: null,
    name: '김민수의 비서',
    isActive: true,
    createdAt: '2026-05-21T09:00:00Z',
    type: 'PERSONAL',
    ownerName: '김민수',
    runtime: 'INTERNAL',
    description: null,
    instructions: null,
    lastKeyUsedAt: null,
  },
]

async function stubAgents(page: Page) {
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: AGENTS }) : r.fallback())
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (r) =>
    r.fulfill({ status: 404, json: { message: '없음' } }))
  await page.route('**/api/v1/admin/workspace-assistant', (r) =>
    r.fulfill({ json: { agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null } }))
}

test('에이전트 표는 휴대폰 폭 안에 들어오고, 아이디·유형·실행은 이름 아래 줄에 보인다', { tag: '@layout' }, async ({ adminPage: page }) => {
  await stubAgents(page)
  await page.goto('/settings/agents')
  const table = page.getByRole('table', { name: '에이전트 목록' })
  await expect(page.getByTestId('agent-row-100')).toBeVisible()

  // 페이지·표 스크롤 칸 모두 가로로 넘치지 않는다
  await expectNoHorizontalOverflow(page)
  const overflow = await table.evaluate((t) => {
    const box = t.parentElement as HTMLElement
    return box.scrollWidth - box.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)

  // 좁은 화면에서는 아이디·유형·실행·생성일 열 머리를 숨긴다
  for (const name of ['아이디', '유형', '실행', '생성일']) {
    await expect(page.getByRole('columnheader', { name })).toBeHidden()
  }

  // 숨긴 값은 이름 아래 한 줄에 모인다
  const meta = page.getByTestId('agent-meta-100')
  await expect(meta).toBeVisible()
  await expect(meta).toContainText('release_coordinator_bot@iacloud.kr')
  await expect(meta).toContainText('공통')
  await expect(meta).toContainText('외부')
  await expect(page.getByTestId('agent-meta-101')).toContainText('개인')
  await expect(page.getByTestId('agent-meta-101')).toContainText('김민수')

  // 행을 누르면 상세 시트가 열린다
  await page.getByTestId('agent-row-100').tap()
  await expect(page.getByTestId('agent-detail-drawer')).toBeVisible()
})
