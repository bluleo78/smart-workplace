// 모바일(390px) AI 위임 작업(WP-377) — 프로젝트 이슈 목록 모바일 행 구조:
// 1줄 상태 아이콘 + 제목 / 2줄 메타(키 · AI 진행 · 에이전트 유형 · 진행률 · 마지막 보고 … 담당자) / 3줄 최근 보고.
// 메타 줄은 자르거나 말줄임하지 않는다 — 진행률은 글자만, 폭이 모자라면 뒤쪽 항목이 다음 줄로 넘어간다.
// 여기엔 대표 행 구조(@wiring)와 잘림·가로 스크롤(@layout)만 남긴다. 에픽 묶음 머리·완료 보기 결과 배지·프로젝트 머리 순서·
// 다음 회차 대기 라벨은 페이지 테스트 src/pages/mobile/aiTasks.test.tsx 가 지킨다(WP-971).
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

test('행 구조 — 상태 아이콘·제목·메타 줄·최근 보고, 가로 넘침 없음', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  const row = page.getByTestId('ai-row-412')
  await expect(row.getByRole('img', { name: '상태: 진행 중' })).toBeVisible()
  await expect(row.getByRole('link', { name: '로그인 실패 시 재시도 제한' })).toBeVisible()
  const meta = page.getByTestId('ai-row-412-meta')
  await expect(meta).toContainText('WP-412')
  await expect(page.getByTestId('ai-row-412-state')).toContainText('답변 필요')
  // 답변 필요 칩은 바로 그 이슈 챗으로 이동하는 링크.
  await expect(page.getByTestId('ai-row-412-state')).toHaveAttribute('href', '/projects/WP/issues/412?chat=1')
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

test('진행률이 있는 행도 에이전트 유형·마지막 보고가 메타 줄 안에 잘리지 않고 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

test('빠른 필터 칩은 가로 스크롤로 마지막 칩까지 닿는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  const chips = page.getByTestId('ai-quick-chips')
  const { scrollWidth, clientWidth } = await chips.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  expect(scrollWidth).toBeGreaterThan(clientWidth)
  await expectNoHorizontalOverflow(page)
  // 마지막 칩은 완료(WP-396).
  const last = page.getByTestId('ai-quick-done')
  await chips.evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
  await expect.poll(() => chips.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(last).toBeInViewport({ ratio: 1 })
  await last.click()
  await expect(last).toHaveAttribute('aria-pressed', 'true')
})

// WP-676: 「완료」·「다음 회차 대기」처럼 오른쪽 끝 칩이 켜진 채 열리면 칩 줄을 그 칩까지 굴려 어떤 보기인지 보이게 한다.
// 칩 줄만 가로로 굴리고 페이지는 움직이지 않는다. 다른 칩을 눌러 바꿔도 켜진 칩이 화면 안에 있다.
for (const [state, key] of [['DONE', 'done'], ['SCHEDULED', 'scheduled']] as const) {
  test(`${state} 칩이 켜진 채 열리면 그 칩이 화면 안에 보인다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await mockApi(page, 'GET', '/api/v1/me/ai-tasks', createIssueSearchResponse(ROWS.slice(0, 1)))
    await mockApi(page, 'GET', '/api/v1/me/ai-tasks/counts', createAiTaskCounts({ all: 6, done: 3, scheduled: 2 }))
    await page.goto(`/me/ai-tasks?state=${state}`)
    const chip = page.getByTestId(`ai-quick-${key}`)
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await expect(chip).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    // 맨 앞 칩으로 바꾸면 줄이 다시 앞으로 돌아와 그 칩이 보인다.
    await page.getByTestId('ai-quick-chips').evaluate((el) => el.scrollTo({ left: el.scrollWidth }))
    await page.getByTestId('ai-quick-chips').evaluate((el) => (el.querySelector('[data-testid="ai-quick-all"]') as HTMLElement).click())
    await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('ai-quick-all')).toBeInViewport({ ratio: 1 })
  })
}
