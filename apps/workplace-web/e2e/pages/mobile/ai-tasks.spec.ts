// 모바일(390px) AI 위임 작업(WP-377) — 프로젝트 이슈 목록 모바일 행 구조:
// 1줄 상태 아이콘 + 제목 / 2줄 메타(키 · AI 진행 · 에이전트 유형 · 진행률 · 마지막 보고 … 담당자) / 3줄 최근 보고.
// 메타 줄은 자르거나 말줄임하지 않는다 — 진행률은 글자만, 폭이 모자라면 뒤쪽 항목이 다음 줄로 넘어간다.
import type { Page } from '@playwright/test'

import { agentWorker as agent, createAgentWork, createAiTaskCounts, minutesAgo } from '../../factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'


const ROWS = [
  createIssue({
    id: 412, number: 412, title: '로그인 실패 시 재시도 제한', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'INPUT_REQUIRED', note: '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(90) })],
  }),
  // 메타 줄이 가장 긴 행들 — 진행률이 있고(검토 필요 100%, 작업 중 3/5 + 무소식) 마지막 보고까지 붙는다.
  createIssue({
    id: 415, number: 415, title: '이슈 목록 CSV 내보내기', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'REVIEW', note: 'PR #512 올렸어요 — 리뷰 부탁드려요', progress: 100, updatedAt: minutesAgo(25) })],
  }),
  createIssue({
    id: 377, number: 377, title: 'AI 도구 작업 기록·AI 위임 작업 표시', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'WORKING', note: 'MCP 헤더 처리 중', stepsDone: 3, stepsTotal: 5, updatedAt: minutesAgo(190), stale: true })],
  }),
  createIssue({ id: 418, number: 418, title: '위키 내보내기 PDF 여백', status: 'TODO', assignees: [agent] }),
  // 인증 필요 · 시작 전(도구 null) — 새 상태 어휘
  createIssue({
    id: 416, number: 416, title: 'GitHub 연동 권한 확인', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'AUTH_REQUIRED', note: 'GitHub 토큰 권한이 필요해요', updatedAt: minutesAgo(40) })],
  }),
  createIssue({
    id: 420, number: 420, title: '검색 인덱스 재생성', status: 'TODO', assignees: [agent],
    agentWork: [createAgentWork({ state: 'SUBMITTED', tool: null, updatedAt: minutesAgo(15) })],
  }),
]

async function setup(page: Page) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/ai-tasks', createIssueSearchResponse(ROWS))
  await mockApi(page, 'GET', '/api/v1/me/ai-tasks/counts', createAiTaskCounts({ all: 6, inputRequired: 1, review: 1, blocked: 1, working: 1 }))
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

test('인증 필요 배지와, 도구를 모르는 시작 전 행(유형 칩·null 없음)', async ({ authenticatedPage: page }) => {
  await setup(page)
  await expect(page.getByTestId('ai-row-416-state')).toContainText('인증 필요')
  await expect(page.getByTestId('ai-row-420-state')).toHaveText('시작 전')
  // 도구가 null 이면 에이전트 유형 칩을 그리지 않고 "null" 글자도 없다. 시작 전은 보고가 없으니 마지막 보고도 없다.
  await expect(page.getByTestId('ai-row-420-tool')).toHaveCount(0)
  await expect(page.getByTestId('ai-row-420')).not.toContainText('null')
  await expect(page.getByTestId('ai-row-420-last')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('진행률이 있는 행도 에이전트 유형·마지막 보고가 메타 줄 안에 잘리지 않고 보인다', async ({ authenticatedPage: page }) => {
  await setup(page)
  for (const id of [415, 377]) {
    const meta = page.getByTestId(`ai-row-${id}-meta`)
    const mb = (await meta.boundingBox())!
    // 메타 줄 밖으로 나가면 잘리거나 가로로 넘친다(toBeVisible 은 잘림을 못 본다) — 폭이 모자라면 줄바꿈이어야 한다.
    for (const part of ['tool', 'last']) {
      const el = page.getByTestId(`ai-row-${id}-${part}`)
      await expect(el).toBeVisible()
      const b = (await el.boundingBox())!
      expect(b.x).toBeGreaterThanOrEqual(mb.x)
      expect(b.x + b.width).toBeLessThanOrEqual(mb.x + mb.width + 0.5)
    }
    // 유형 칩은 줄지 않는다 — 글자 전체(말줄임 없음).
    const tool = page.getByTestId(`ai-row-${id}-tool`)
    await expect(tool).toHaveText('Claude Code')
    expect(await tool.evaluate((e) => [...e.querySelectorAll('*'), e].every((n) => n.scrollWidth <= n.clientWidth))).toBe(true)
    // 모바일 진행률은 글자만(막대 없음).
    await expect(page.getByTestId(`ai-row-${id}-progress`).locator('[aria-hidden]')).toHaveCount(0)
  }
  await expect(page.getByTestId('ai-row-415-progress')).toHaveText('100%')
  await expect(page.getByTestId('ai-row-377-progress')).toHaveText('3/5')
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
