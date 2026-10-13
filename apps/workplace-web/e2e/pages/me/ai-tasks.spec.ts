// AI 위임 작업(WP-377) — 범위(나와 관련/전체)·빠른 필터 칩·AI 진행 표.
// 조회는 /me/ai-tasks(목록)·/me/ai-tasks/counts(칩 건수) 서버 조건으로 하고, 화면은 서버 순서를 그대로 그린다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createAgentWork, createAiTaskCounts, minutesAgo } from '../../factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { DESKTOP_WIDTHS, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
import type { IssueResponse } from '../../../src/types/issue'
import type { UserSummary } from '../../../src/types/user'

const human: UserSummary = { id: 1, username: 'kim', name: '김사람', kind: 'HUMAN' }
const agent: UserSummary = { id: 9, username: 'aki', name: '아키', kind: 'AGENT' }

const LIST = '/api/v1/me/ai-tasks'
const COUNTS = '/api/v1/me/ai-tasks/counts'
const STALE_TOOLTIP = '2시간 넘게 보고가 없어요'

// 서버가 급한 순으로 준 행 — 화면은 이 순서를 그대로 그린다(클라이언트 재정렬 금지).
// 마지막 보고 시각은 relTime 버킷 경계(분·시간)를 피한 값으로 둔다(느린 실행에도 표기가 안 바뀌게).
const ROWS: IssueResponse[] = [
  createIssue({
    id: 412, number: 412, title: '로그인 실패 시 재시도 제한', status: 'IN_PROGRESS', priority: 'HIGH', assignees: [agent, human],
    agentWork: [
      createAgentWork({ worker: agent, state: 'WAITING', note: '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(90) }),
      createAgentWork({ worker: human, state: 'WORKING', updatedAt: minutesAgo(10) }),
    ],
  }),
  createIssue({
    id: 415, number: 415, title: '이슈 목록 CSV 내보내기', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'REVIEW', note: 'PR #512 올렸어요 — 리뷰 부탁드려요', progress: 100 })],
  }),
  createIssue({
    id: 377, number: 377, title: 'AI 도구 작업 기록 표시', status: 'IN_PROGRESS', assignees: [human],
    agentWork: [createAgentWork({ worker: human, state: 'WORKING', note: 'MCP 헤더 처리 중', stepsDone: 3, stepsTotal: 5 })],
  }),
  createIssue({
    id: 380, number: 380, title: '알림 설정 화면 다크모드 대비', status: 'IN_PROGRESS', assignees: [human],
    agentWork: [createAgentWork({ worker: human, state: 'WORKING', updatedAt: minutesAgo(190), stale: true })],
  }),
  // 진행 중 작업 없음 + AI 담당 + 할 일 → 시작 전
  createIssue({ id: 418, number: 418, title: '위키 내보내기 PDF 여백', status: 'TODO', assignees: [agent] }),
]

/** 목록·건수를 모킹하고 두 요청을 캡처한다. */
async function setup(page: Page, items: IssueResponse[] = ROWS, counts = createAiTaskCounts({ all: 5, waiting: 7, review: 1, working: 2 })) {
  const list = await mockApi(page, 'GET', LIST, createIssueSearchResponse(items), { capture: true })
  const cnt = await mockApi(page, 'GET', COUNTS, counts, { capture: true })
  return { list, cnt }
}

test('기본은 나와 관련(scope=MINE) — reporter 파라미터 없이 /me/ai-tasks 를 부른다', async ({ authenticatedPage: page }) => {
  const { list, cnt } = await setup(page)
  await page.goto('/me/ai-tasks')

  const req = await list.waitForRequest()
  expect(req.searchParams.get('scope')).toBe('MINE')
  expect(req.searchParams.has('reporter')).toBe(false)
  expect(req.searchParams.has('agentState')).toBe(false)
  expect((await cnt.waitForRequest()).searchParams.get('scope')).toBe('MINE')
  await expect(page.getByTestId('ai-scope-mine')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ai-scope-all')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true')
})

test('행에 AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고를 서버 순서대로 보인다', async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.goto('/me/ai-tasks')

  // 서버 순서 그대로 — 작업 중(377)이 시작 전(418)보다, 답변 필요(412)가 맨 앞.
  await expect(page.getByTestId('ai-row-418')).toBeVisible()
  const ids = await page.locator('[data-testid^="ai-row-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid')).filter((t) => /^ai-row-\d+$/.test(t ?? '')),
  )
  expect(ids).toEqual(['ai-row-412', 'ai-row-415', 'ai-row-377', 'ai-row-380', 'ai-row-418'])

  await expect(page.getByTestId('ai-row-412-state')).toContainText('답변 필요')
  await expect(page.getByTestId('ai-row-415-state')).toContainText('검토 필요')
  await expect(page.getByTestId('ai-row-377-state')).toContainText('작업 중')
  await expect(page.getByTestId('ai-row-418-state')).toContainText('시작 전')

  // 최근 보고 — 한 줄 말줄임 + 마우스 올리면 전체(title).
  const note = page.getByTestId('ai-row-412-note')
  await expect(note).toHaveText('잠금 시간을 5분/30분 중 어느 쪽으로 할까요?')
  await expect(note).toHaveAttribute('title', '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?')
  await expect(page.getByTestId('ai-row-380-note')).toHaveText('—')

  // 진행률 — 단계가 있으면 3/5, progress 만 있으면 퍼센트, 없으면 —.
  await expect(page.getByTestId('ai-row-377-progress')).toContainText('3/5')
  await expect(page.getByTestId('ai-row-415-progress')).toContainText('100%')
  await expect(page.getByTestId('ai-row-412-progress')).toHaveText('—')

  // 에이전트 유형 — claude-code → Claude Code. 작업이 없는 행은 —.
  await expect(page.getByTestId('ai-row-412-tool')).toHaveText('Claude Code')
  await expect(page.getByTestId('ai-row-418').getByTestId('ai-row-418-tool')).toHaveCount(0)

  // 마지막 보고 — 상대 시각(90분 전 → 1시간 전).
  await expect(page.getByTestId('ai-row-412-last')).toHaveText('1시간 전')
  await expect(page.getByTestId('ai-row-412-last')).not.toHaveAttribute('title', STALE_TOOLTIP)

  // 담당자 — 대표 작업 작업자 아바타(AI 는 에이전트 표식) + 진행 중 작업이 2건이면 +1.
  const row = page.getByTestId('ai-row-412')
  await expect(row.getByTestId(`user-avatar-${agent.id}`)).toBeVisible()
  await expect(row.getByTestId(`user-avatar-${agent.id}-agent-marker`)).toBeVisible()
  await expect(row.getByTestId(`user-avatar-${human.id}`)).toHaveCount(0)
  await expect(row).toContainText('+1')
  // 시작 전 행은 작업자가 없어 첫 AI 담당자.
  await expect(page.getByTestId('ai-row-418').getByTestId(`user-avatar-${agent.id}`)).toBeVisible()

  // 제목은 이슈 상세 링크.
  await expect(row.getByRole('link', { name: '로그인 실패 시 재시도 제한' })).toHaveAttribute('href', '/projects/WP/issues/412')
})

test('무소식 행은 마지막 보고에 경고 아이콘과 툴팁', async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.goto('/me/ai-tasks')
  const last = page.getByTestId('ai-row-380-last')
  await expect(last).toHaveText('3시간 전')
  await expect(last).toHaveAttribute('title', STALE_TOOLTIP)
  await expect(last.locator('svg')).toBeVisible()
})

test('전체 범위·빠른 필터 칩이 URL 과 요청에 반영되고, 칩 건수는 counts 값', async ({ authenticatedPage: page }) => {
  const { list, cnt } = await setup(page)
  await page.goto('/me/ai-tasks')
  await list.waitForRequest()

  // 칩 건수는 목록 행 수가 아니라 counts 응답 값(답변 필요 7 ≠ 행 1).
  await expect(page.getByTestId('ai-quick-count-all')).toHaveText('5')
  await expect(page.getByTestId('ai-quick-count-waiting')).toHaveText('7')
  await expect(page.getByTestId('ai-quick-count-review')).toHaveText('1')
  await expect(page.getByTestId('ai-quick-count-blocked')).toHaveText('0')
  await expect(page.getByTestId('ai-quick-count-working')).toHaveText('2')
  await expect(page.getByTestId('ai-quick-waiting')).toContainText('답변 필요')

  await page.getByTestId('ai-scope-all').click()
  await expect(page).toHaveURL(/[?&]scope=all/)
  await expect(page.getByTestId('ai-scope-all')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => list.lastRequest()?.searchParams.get('scope')).toBe('ALL')
  await expect.poll(() => cnt.lastRequest()?.searchParams.get('scope')).toBe('ALL')

  await page.getByTestId('ai-quick-waiting').click()
  await expect(page).toHaveURL(/[?&]state=WAITING/)
  await expect(page.getByTestId('ai-quick-waiting')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => list.lastRequest()?.searchParams.get('agentState')).toBe('WAITING')
  // 범위는 유지, 건수 요청엔 빠른 필터를 싣지 않는다(칩마다 자기 건수).
  expect(list.lastRequest()?.searchParams.get('scope')).toBe('ALL')
  expect(cnt.requests.every((r) => !r.searchParams.has('agentState'))).toBe(true)

  // 전체 칩 → state 제거, 나와 관련 → scope 제거(이미 받은 조합은 캐시로 그려 요청이 다시 안 날 수 있어 URL·눌림으로 본다).
  await page.getByTestId('ai-quick-all').click()
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.has('state')).toBe(false)
  await page.getByTestId('ai-scope-mine').click()
  await expect(page.getByTestId('ai-scope-mine')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.has('scope')).toBe(false)
})

test('상태 facet 이 목록·건수 요청 모두에 status 로 합쳐진다', async ({ authenticatedPage: page }) => {
  const { list, cnt } = await setup(page)
  await page.goto('/me/ai-tasks?state=REVIEW')
  await list.waitForRequest()

  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-status').click()
  await page.getByTestId('facet-value-status-DONE').click()

  await expect.poll(() => list.lastRequest()?.searchParams.get('status')).toBe('DONE')
  await expect.poll(() => cnt.lastRequest()?.searchParams.get('status')).toBe('DONE')
  // facet 을 바꿔도 빠른 필터는 유지된다.
  expect(list.lastRequest()?.searchParams.get('agentState')).toBe('REVIEW')
})

test('비어 있으면 안내 문구, 빠른 필터 중이면 조건 문구', async ({ authenticatedPage: page }) => {
  await setup(page, [], createAiTaskCounts())
  await page.goto('/me/ai-tasks')
  // DS §2.5 빈 상태 — [아이콘(svg)+제목+설명] 3요소.
  const empty = page.getByTestId('ai-row-empty')
  await expect(empty).toBeVisible()
  await expect(empty.locator('svg')).toBeVisible()
  await expect(empty).toContainText('AI가 진행 중인 작업이 없어요')
  await expect(empty).toContainText('담당자를 AI 구성원으로 지정하거나, Claude Code 같은 AI 도구로 내 이슈를 작업하면 여기에 표시돼요.')

  await expect(page.getByTestId('ai-empty-reset')).toHaveCount(0)

  await page.getByTestId('ai-quick-blocked').click()
  await expect(empty).toContainText('조건에 맞는 AI 작업이 없어요')
  await expect(empty).not.toContainText('AI가 진행 중인 작업이 없어요')
  await expect(page.getByTestId('ai-empty-reset')).toBeVisible()
})

test('facet 만 걸려도 조건 문구 — 필터 초기화는 빠른 필터·facet 을 지우고 범위는 남긴다', async ({ authenticatedPage: page }) => {
  await setup(page, [], createAiTaskCounts())
  await page.goto('/me/ai-tasks?status=DONE')
  const empty = page.getByTestId('ai-row-empty')
  await expect(empty).toContainText('조건에 맞는 AI 작업이 없어요')
  await expect(page.getByTestId('ai-empty-reset')).toBeVisible()

  await page.goto('/me/ai-tasks?scope=all&state=BLOCKED&status=DONE&priority=HIGH')
  await expect(empty).toContainText('조건에 맞는 AI 작업이 없어요')
  await page.getByTestId('ai-empty-reset').click()
  await expect.poll(() => [...new URL(page.url()).searchParams.keys()]).toEqual(['scope'])
  expect(new URL(page.url()).searchParams.get('scope')).toBe('all')
  await expect(empty).toContainText('AI가 진행 중인 작업이 없어요')
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ai-scope-all')).toHaveAttribute('aria-pressed', 'true')
})

// 마감·막힘은 /me/ai-tasks 가 무시하는 facet — 요청에 싣지 않고, 걸려 있어도 "조건 문구"가 아니라 기본 안내를 보인다.
test('서버가 무시하는 마감·막힘 facet 은 보내지 않고 필터로 보지 않는다', async ({ authenticatedPage: page }) => {
  const { list, cnt } = await setup(page, [], createAiTaskCounts())
  await page.goto('/me/ai-tasks?blocked=true&dueTo=2026-10-31&dueDate=today')
  const empty = page.getByTestId('ai-row-empty')
  await expect(empty).toContainText('AI가 진행 중인 작업이 없어요')
  await expect(page.getByTestId('ai-empty-reset')).toHaveCount(0)
  for (const req of [await list.waitForRequest(), await cnt.waitForRequest()]) {
    const keys = [...req.searchParams.keys()]
    expect(keys).not.toContain('blocked')
    expect(keys).not.toContain('dueFrom')
    expect(keys).not.toContain('dueTo')
  }
})

test('첫 페이지 실패는 빈 상태가 아니라 오류 + 다시 시도', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', LIST, { message: 'boom' }, { status: 500 })
  await mockApi(page, 'GET', COUNTS, createAiTaskCounts())
  await page.goto('/me/ai-tasks')
  const error = page.getByTestId('ai-tasks-error')
  await expect(error).toContainText('AI 위임 작업을 불러오지 못했습니다')
  await expect(page.getByTestId('ai-row-empty')).toHaveCount(0)

  // 다시 시도 — 이번엔 성공(나중 등록 라우트가 우선).
  await mockApi(page, 'GET', LIST, createIssueSearchResponse(ROWS))
  await error.getByRole('button', { name: '다시 시도' }).click()
  await expect(page.getByTestId('ai-row-412')).toBeVisible()
  await expect(error).toHaveCount(0)
})

// 페이지 레이아웃 — 헤더 바 안 h1·하단 56px·툴바와 같은 시작선, 표가 가로로 넘치지 않음(1280 포함 넓은 화면).
for (const width of [1280, ...DESKTOP_WIDTHS]) {
  test.describe(`AI 위임 작업 레이아웃 @${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    test('제목은 헤더 바 안 h1, 툴바와 같은 x, 표 가로 넘침 없음', async ({ authenticatedPage: page }) => {
      await setup(page)
      await page.goto('/me/ai-tasks')
      const header = page.getByTestId('page-header')
      const title = header.getByRole('heading', { level: 1, name: 'AI 위임 작업' })
      await expect(title).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: 'AI 위임 작업' })).toHaveCount(1)
      await expectHeaderBottomAt56(header)
      await expectStartAligned(title, page.getByTestId('ai-tasks-toolbar'))

      await expect(page.getByTestId('ai-row-412')).toBeVisible()
      const table = page.getByTestId('ai-tasks-table')
      const { scrollWidth, clientWidth } = await table.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  })
}
