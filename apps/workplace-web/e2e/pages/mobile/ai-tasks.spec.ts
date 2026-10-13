// 모바일(390px) AI 위임 작업(WP-377) — 프로젝트 이슈 목록 모바일 행 구조:
// 1줄 상태 아이콘 + 제목 / 2줄 메타(키 · AI 진행 · 에이전트 유형 · 진행률 · 마지막 보고 … 담당자) / 3줄 최근 보고.
// 메타 줄이 넘쳐도 마지막 보고는 잘리지 않고, 에이전트 유형 칩이 먼저 줄어든다.
import type { Page } from '@playwright/test'

import { createAgentWork, createAiTaskCounts, minutesAgo } from '../../factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import type { UserSummary } from '../../../src/types/user'

const agent: UserSummary = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' }

const ROWS = [
  createIssue({
    id: 412, number: 412, title: '로그인 실패 시 재시도 제한', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'WAITING', note: '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(90) })],
  }),
  // 메타 줄이 가장 긴 행들 — 진행률이 있고(검토 필요 100%, 막힘 3/5) 마지막 보고까지 붙는다.
  createIssue({
    id: 415, number: 415, title: '이슈 목록 CSV 내보내기', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'REVIEW', note: 'PR #512 올렸어요 — 리뷰 부탁드려요', progress: 100, updatedAt: minutesAgo(25) })],
  }),
  createIssue({
    id: 377, number: 377, title: 'AI 도구 작업 기록·AI 위임 작업 표시', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'WORKING', note: 'MCP 헤더 처리 중', stepsDone: 3, stepsTotal: 5, updatedAt: minutesAgo(190), stale: true })],
  }),
  createIssue({ id: 418, number: 418, title: '위키 내보내기 PDF 여백', status: 'TODO', assignees: [agent] }),
]

async function setup(page: Page) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/ai-tasks', createIssueSearchResponse(ROWS))
  await mockApi(page, 'GET', '/api/v1/me/ai-tasks/counts', createAiTaskCounts({ all: 4, waiting: 1, review: 1, working: 1 }))
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('ai-row-412')).toBeVisible()
}

test('행 구조 — 상태 아이콘·제목·메타 줄·최근 보고, 가로 넘침 없음', async ({ authenticatedPage: page }) => {
  await setup(page)
  const row = page.getByTestId('ai-row-412')
  await expect(row.getByRole('img', { name: '상태: 진행 중' })).toBeVisible()
  await expect(row.getByRole('link', { name: '로그인 실패 시 재시도 제한' })).toBeVisible()
  const meta = page.getByTestId('ai-row-412-meta')
  await expect(meta).toContainText('WP-412')
  await expect(page.getByTestId('ai-row-412-state')).toContainText('답변 필요')
  await expect(page.getByTestId('ai-row-412-tool')).toContainText('Claude Code')
  await expect(page.getByTestId('ai-row-412-last')).toHaveText('1시간 전')
  await expect(page.getByTestId('ai-row-412-note')).toHaveText('잠금 시간을 5분/30분 중 어느 쪽으로 할까요?')
  await expect(row.getByTestId(`user-avatar-${agent.id}-agent-marker`)).toBeVisible()
  // 시작 전 행 — 배지만, 작업 정보(유형·진행률·마지막 보고·최근 보고)는 없다.
  await expect(page.getByTestId('ai-row-418-state')).toContainText('시작 전')
  await expect(page.getByTestId('ai-row-418-last')).toHaveCount(0)
  await expect(page.getByTestId('ai-row-418-note')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('진행률이 있는 행도 마지막 보고가 메타 줄 안에 완전히 보인다', async ({ authenticatedPage: page }) => {
  await setup(page)
  for (const id of [415, 377]) {
    const last = page.getByTestId(`ai-row-${id}-last`)
    await expect(last).toBeVisible()
    await expect(page.getByTestId(`ai-row-${id}-progress`)).toBeVisible()
    // 메타 줄은 overflow-hidden — 잘리면 오른쪽 끝이 메타 줄 밖으로 나간다(toBeVisible 은 잘림을 못 본다).
    const lb = (await last.boundingBox())!
    const mb = (await page.getByTestId(`ai-row-${id}-meta`).boundingBox())!
    expect(lb.x + lb.width).toBeLessThanOrEqual(mb.x + mb.width + 0.5)
    expect(lb.x).toBeGreaterThanOrEqual(mb.x)
  }
  await expect(page.getByTestId('ai-row-377-last')).toHaveText('3시간 전')
})

test('빠른 필터 칩은 가로 스크롤로 마지막 칩까지 닿는다', async ({ authenticatedPage: page }) => {
  await setup(page)
  const chips = page.getByTestId('ai-quick-chips')
  const { scrollWidth, clientWidth } = await chips.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  expect(scrollWidth).toBeGreaterThan(clientWidth)
  await expectNoHorizontalOverflow(page)
  const last = page.getByTestId('ai-quick-working')
  await chips.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect.poll(() => chips.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(last).toBeInViewport({ ratio: 1 })
  await last.click()
  await expect(last).toHaveAttribute('aria-pressed', 'true')
})
