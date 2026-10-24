// AI 위임 작업(WP-377) — 범위(나와 관련/전체)·빠른 필터 칩·AI 진행 표.
// 조회는 /me/ai-tasks(목록)·/me/ai-tasks/counts(칩 건수) 서버 조건으로 하고, 화면은 서버 순서를 그대로 그린다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { agentWorker as agent, createAgentWork, createAiTaskCounts, createScheduledIssue, KST_1430, minutesAgo } from '../../factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { GROUPED_ROWS } from '../../fixtures/ai-tasks-groups'
import { projectRows } from '../../fixtures/ai-tasks-projects'
import { DESKTOP_WIDTHS, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
import type { IssueResponse } from '../../../src/types/issue'
import type { UserSummary } from '../../../src/types/user'

const human: UserSummary = { id: 1, username: 'kim', name: '김사람', kind: 'HUMAN' }

const LIST = '/api/v1/me/ai-tasks'
const COUNTS = '/api/v1/me/ai-tasks/counts'
const STALE_TOOLTIP = '2시간 넘게 보고가 없어요'

// 서버가 급한 순으로 준 행 — 화면은 이 순서를 그대로 그린다(클라이언트 재정렬 금지).
// 마지막 보고 시각은 relTime 버킷 경계(분·시간)를 피한 값으로 둔다(느린 실행에도 표기가 안 바뀌게).
const ROWS: IssueResponse[] = [
  createIssue({
    id: 412, number: 412, title: '로그인 실패 시 재시도 제한', status: 'IN_PROGRESS', priority: 'HIGH', assignees: [agent, human],
    agentWork: [
      createAgentWork({ worker: agent, state: 'INPUT_REQUIRED', note: '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(90) }),
      createAgentWork({ worker: human, state: 'WORKING', updatedAt: minutesAgo(10) }),
    ],
  }),
  // 인증 필요 — 답변 필요 다음(서버 순서: 답변 → 인증 → 검토)
  createIssue({
    id: 416, number: 416, title: 'GitHub 연동 권한 확인', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'AUTH_REQUIRED', note: 'GitHub 토큰 권한이 필요해요', updatedAt: minutesAgo(40) })],
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
  // 시작 전 — 외부 AI 가 담당자로 들어왔지만 아직 도구를 모르는 행(tool null)
  createIssue({
    id: 420, number: 420, title: '검색 인덱스 재생성', status: 'TODO', assignees: [agent],
    agentWork: [createAgentWork({ state: 'SUBMITTED', tool: null, updatedAt: minutesAgo(15) })],
  }),
  // 진행 중 작업 없음 + AI 담당 + 할 일 → 시작 전
  createIssue({ id: 418, number: 418, title: '위키 내보내기 PDF 여백', status: 'TODO', assignees: [agent] }),
]

/** 목록·건수를 모킹하고 두 요청을 캡처한다. */
async function setup(page: Page, items: IssueResponse[] = ROWS, counts = createAiTaskCounts({ all: 6, inputRequired: 7, review: 1, blocked: 3, working: 2 })) {
  const list = await mockApi(page, 'GET', LIST, createIssueSearchResponse(items), { capture: true })
  const cnt = await mockApi(page, 'GET', COUNTS, counts, { capture: true })
  return { list, cnt }
}

test('행에 AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고를 서버 순서대로 보인다', async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.goto('/me/ai-tasks')

  // 서버 순서 그대로 — 답변 필요(412) → 인증 필요(416) → 검토 필요(415) → 작업 중 → 시작 전(420 → 418).
  await expect(page.getByTestId('ai-row-418')).toBeVisible()
  const ids = await page.locator('[data-testid^="ai-row-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid')).filter((t) => /^ai-row-\d+$/.test(t ?? '')),
  )
  expect(ids).toEqual(['ai-row-412', 'ai-row-416', 'ai-row-415', 'ai-row-377', 'ai-row-380', 'ai-row-420', 'ai-row-418'])

  await expect(page.getByTestId('ai-row-412-state')).toContainText('답변 필요')
  await expect(page.getByTestId('ai-row-416-state')).toContainText('인증 필요')
  await expect(page.getByTestId('ai-row-415-state')).toContainText('검토 필요')
  await expect(page.getByTestId('ai-row-377-state')).toContainText('작업 중')
  await expect(page.getByTestId('ai-row-418-state')).toContainText('시작 전')
  await expect(page.getByTestId('ai-row-420-state')).toHaveText('시작 전')

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
  // 시작 전(SUBMITTED, 도구 null) 행은 에이전트 유형 칸이 — 이고 null 글자는 없다. 열 순서상 에이전트 유형은 9번째 칸.
  await expect(page.getByTestId('ai-row-420-tool')).toHaveCount(0)
  await expect(page.getByTestId('ai-row-420').locator('td').nth(8)).toHaveText('—')
  await expect(page.getByTestId('ai-row-420')).not.toContainText('null')
  // 시작 전은 보고가 없어 마지막 보고 칸도 —(10번째 칸). 시각 표기가 없다.
  await expect(page.getByTestId('ai-row-420-last')).toHaveCount(0)
  await expect(page.getByTestId('ai-row-420').locator('td').nth(9)).toHaveText('—')

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

  // 답변 필요 칩은 바로 그 이슈 챗으로 이동하는 링크(클릭 한 번으로 질문에 답하러 간다). 인증/검토 필요 칩은 이동 없음(아직 답변 전용으로만 연결).
  await expect(page.getByTestId('ai-row-412-state')).toHaveAttribute('href', '/projects/WP/issues/412?chat=1')
  await expect(page.getByTestId('ai-row-416-state')).not.toHaveAttribute('href', /.+/)
  await expect(page.getByTestId('ai-row-415-state')).not.toHaveAttribute('href', /.+/)
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
  await expect(page.getByTestId('ai-quick-count-all')).toHaveText('6')
  await expect(page.getByTestId('ai-quick-count-inputRequired')).toHaveText('7')
  await expect(page.getByTestId('ai-quick-count-review')).toHaveText('1')
  await expect(page.getByTestId('ai-quick-count-blocked')).toHaveText('3')
  await expect(page.getByTestId('ai-quick-count-working')).toHaveText('2')
  await expect(page.getByTestId('ai-quick-inputRequired')).toContainText('답변 필요')
  // 기본 칩은 「미완료」(옛 「전체」 자리) — 범위 버튼 「전체」와도 겹치지 않는다(WP-396).
  await expect(page.getByTestId('ai-quick-all')).toContainText('미완료')

  await page.getByTestId('ai-scope-all').click()
  await expect(page).toHaveURL(/[?&]scope=all/)
  await expect(page.getByTestId('ai-scope-all')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => list.lastRequest()?.searchParams.get('scope')).toBe('ALL')
  await expect.poll(() => cnt.lastRequest()?.searchParams.get('scope')).toBe('ALL')

  await page.getByTestId('ai-quick-inputRequired').click()
  await expect(page).toHaveURL(/[?&]state=INPUT_REQUIRED/)
  await expect(page.getByTestId('ai-quick-inputRequired')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => list.lastRequest()?.searchParams.get('agentState')).toBe('INPUT_REQUIRED')
  // 범위는 유지, 건수 요청엔 빠른 필터를 싣지 않는다(칩마다 자기 건수).
  expect(list.lastRequest()?.searchParams.get('scope')).toBe('ALL')
  expect(cnt.requests.every((r) => !r.searchParams.has('agentState'))).toBe(true)

  // 미완료 칩 → state 제거, 나와 관련 → scope 제거(이미 받은 조합은 캐시로 그려 요청이 다시 안 날 수 있어 URL·눌림으로 본다).
  await page.getByTestId('ai-quick-all').click()
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.has('state')).toBe(false)
  await page.getByTestId('ai-scope-mine').click()
  await expect(page.getByTestId('ai-scope-mine')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => new URL(page.url()).searchParams.has('scope')).toBe(false)
})

// WP-396: 완료 칩 — 미완료와 배타인 별도 보기. 종료 상태 넷을 쉼표 목록으로 요청하고, 행 배지는 실제 결과(완료·실패·취소·반려)를 톤으로 구분한다.
const DONE_ROWS: IssueResponse[] = [
  createIssue({
    id: 501, number: 501, title: '결제 웹훅 재시도 정책 정리', status: 'DONE', assignees: [agent],
    agentWork: [createAgentWork({ state: 'COMPLETED', note: 'PR #530 병합 완료', progress: 100, updatedAt: minutesAgo(3 * 24 * 60), endedAt: minutesAgo(20) })],
  }),
  createIssue({
    id: 502, number: 502, title: '대용량 첨부 미리보기 생성 실패 원인 조사', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'FAILED', note: '샌드박스 메모리 한도 초과로 중단', updatedAt: minutesAgo(90), endedAt: minutesAgo(90) })],
  }),
  createIssue({
    id: 503, number: 503, title: '구 알림 설정 마이그레이션', status: 'CANCELED', assignees: [agent],
    agentWork: [createAgentWork({ state: 'CANCELED', updatedAt: minutesAgo(200), endedAt: minutesAgo(200) })],
  }),
  // 조회 사이 작업이 다시 시작된 행 — 서버가 진행 중 작업을 실어 보내 endedAt 이 없다(「종료」 칸이지만 마지막 보고 시각).
  createIssue({
    id: 505, number: 505, title: '재시작된 작업', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'WORKING', updatedAt: minutesAgo(5) })],
  }),
  createIssue({
    id: 504, number: 504, title: '외부 저장소 권한 없는 작업', status: 'TODO', assignees: [human],
    agentWork: [createAgentWork({ worker: human, state: 'REJECTED', note: '권한 밖 저장소라 맡지 않아요', updatedAt: minutesAgo(300), endedAt: minutesAgo(300) })],
  }),
]

test('완료 칩은 종료 상태로 요청하고 done 건수, 행 배지는 결과별 톤', async ({ authenticatedPage: page }) => {
  const { list, cnt } = await setup(page, DONE_ROWS, createAiTaskCounts({ all: 6, done: 4 }))
  await page.goto('/me/ai-tasks')
  await list.waitForRequest()
  // 칩 순서 — 미완료·답변 필요·검토 필요·막힘·작업 중·다음 회차 대기·완료.
  const chipIds = await page.getByTestId('ai-quick-chips').locator('button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(chipIds).toEqual(['ai-quick-all', 'ai-quick-inputRequired', 'ai-quick-review', 'ai-quick-blocked', 'ai-quick-working', 'ai-quick-scheduled', 'ai-quick-done'])
  await expect(page.getByTestId('ai-quick-scheduled')).toContainText('다음 회차 대기')
  await expect(page.getByTestId('ai-quick-done')).toContainText('완료')
  await expect(page.getByTestId('ai-quick-count-done')).toHaveText('4')

  await page.getByTestId('ai-quick-done').click()
  await expect(page).toHaveURL(/[?&]state=DONE/)
  await expect(page.getByTestId('ai-quick-done')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => list.lastRequest()?.searchParams.get('agentState')).toBe('COMPLETED,FAILED,CANCELED,REJECTED')
  expect(cnt.requests.every((r) => !r.searchParams.has('agentState'))).toBe(true)

  // 결과별 배지 — 완료 success·실패 옅은 위험 tint(진한 채움 아님)·취소·반려 중립 윤곽.
  await expect(page.getByTestId('ai-row-501-state')).toHaveText('완료')
  await expect(page.getByTestId('ai-row-501-state')).toHaveAttribute('data-variant', 'success')
  await expect(page.getByTestId('ai-row-502-state')).toHaveText('실패')
  await expect(page.getByTestId('ai-row-502-state')).toHaveClass(/bg-destructive\/10/)
  await expect(page.getByTestId('ai-row-502-state')).not.toHaveAttribute('data-variant', 'destructive')
  await expect(page.getByTestId('ai-row-503-state')).toHaveText('취소')
  await expect(page.getByTestId('ai-row-503-state')).toHaveAttribute('data-variant', 'outline')
  await expect(page.getByTestId('ai-row-504-state')).toHaveText('반려')
  await expect(page.getByTestId('ai-row-504-state')).toHaveAttribute('data-variant', 'outline')

  // 시간 칸은 종료 시각 — 칸 제목 「종료」, 마지막 보고(3일 전)가 아니라 종료(20분 전), 툴팁에 「종료」.
  await expect(page.getByTestId('ai-tasks-table').locator('th').last()).toHaveText('종료')
  await expect(page.getByTestId('ai-row-501-last')).toHaveText('20분 전')
  await expect(page.getByTestId('ai-row-501-last')).toHaveAttribute('title', '종료 20분 전')
  // 시각 표시는 행마다 — endedAt 없는 행은 툴팁으로 마지막 보고 시각임을 밝힌다.
  await expect(page.getByTestId('ai-row-505-last')).toHaveAttribute('title', '마지막 보고 5분 전')
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

// 에픽 묶음(WP-375) — 서버가 묶음 단위로 정렬해 준 행을 머리 + 들여쓴 하위 행으로 그린다.
test('에픽 묶음 머리 아래 하위 행이 들여쓰기되고 에픽 부모 칩은 숨는다', async ({ authenticatedPage: page }) => {
  await setup(page, GROUPED_ROWS)
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('ai-epic-412')).toContainText('WP-412')
  await expect(page.getByTestId('ai-epic-412')).toContainText('└ 1/5')
  await expect(page.getByTestId('ai-row-412')).toHaveCount(0) // 에픽 행은 머리로만
  await expect(page.getByTestId('ai-epic-412').getByTestId('ai-row-412-state')).toBeVisible() // 머리 줄에 에픽 자신 AI 진행
  const titleCell = page.getByTestId('ai-row-413').locator('td').nth(3).locator('div').first()
  await expect(titleCell).toHaveCSS('padding-left', '20px')
  await expect(page.getByTestId('issue-row-413-parent')).toHaveCount(0)
  await expect(page.getByTestId('ai-epic-420')).toBeVisible() // 에픽 행 없는 묶음도 머리
  await expect(page.getByTestId('ai-epic-420').getByTestId('ai-row-420-state')).toHaveCount(0) // AI 칸은 비움
})

test('묶이지 않은 행의 부모 칩은 키를 먼저 보인다', async ({ authenticatedPage: page }) => {
  await setup(page, GROUPED_ROWS)
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('issue-row-431-parent')).toContainText('WP-377')
  await expect(page.getByTestId('issue-row-431-parent')).toContainText('AI 작업 기록')
  // 1280 에서도 키 뒤에 부모 제목이 폭 0 으로 숨지 않고 앞 글자가 말줄임으로 보인다(제목 칸이 칩 몫을 남긴다).
  const parentTitle = page.getByTestId('issue-row-431-parent').locator('span').last()
  expect((await parentTitle.boundingBox())!.width).toBeGreaterThan(12)
  // 1440 부터는 최근 보고 칸이 넓어진다(WP-450) — 그래도 부모 제목 몫이 남는다.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await parentTitle.boundingBox())!.width).toBeGreaterThan(12)
})

test('다음 페이지의 하위 행은 같은 머리 아래 이어 붙는다', async ({ authenticatedPage: page }) => {
  const rows = GROUPED_ROWS.filter((r) => [421, 422, 430].includes(r.number)).map((r) => (
    r.aiGroup ? { ...r, aiGroup: { ...r.aiGroup, size: 2 } } : r))
  // 1페이지: [421] + nextCursor, 2페이지(cursor=c2): [422, 430].
  await page.route((u) => u.pathname === LIST, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    return route.fulfill({
      json: cursor === 'c2'
        ? createIssueSearchResponse([rows[1], rows[2]])
        : createIssueSearchResponse([rows[0]], 'c2'),
    })
  })
  await mockApi(page, 'GET', COUNTS, createAiTaskCounts())
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('ai-row-430')).toBeVisible()
  await expect(page.getByTestId('ai-epic-420')).toHaveCount(1)
  const order = await page.locator('[data-testid^="ai-row-"], [data-testid^="ai-epic-"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')).filter((t) => /^ai-(row|epic)-\d+$/.test(t ?? '')))
  expect(order).toEqual(['ai-epic-420', 'ai-row-421', 'ai-row-422', 'ai-row-430'])
})

// WP-426: 서버가 프로젝트 단위로 이어 준 행을 프로젝트 머리 줄 아래에 묶는다. 머리 건수는 서버 값(aiProject.size).
test('프로젝트별 머리 줄 아래에 그 프로젝트 행이 서버 순서대로 온다', async ({ authenticatedPage: page }) => {
  await setup(page, projectRows())
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('ai-row-2061')).toBeVisible()

  // 머리 줄 순서 — 서버가 준 프로젝트 순서(WP → HR → MKT).
  const heads = await page.locator('[data-testid^="ai-project-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid')).filter((t) => /^ai-project-[A-Z]+-head$/.test(t ?? '')),
  )
  expect(heads).toEqual(['ai-project-WP-head', 'ai-project-HR-head', 'ai-project-MKT-head'])

  // 이름 링크·건수 — 건수는 불러온 2행이 아니라 서버가 준 4.
  const name = page.getByTestId('ai-project-HR-head-name')
  await expect(name).toHaveText('인사팀')
  await expect(name).toHaveAttribute('href', '/projects/HR')
  await expect(page.getByTestId('ai-project-HR-head-count')).toHaveText('HR · 4')
  await expect(page.getByTestId('ai-project-WP-head-count')).toHaveText('WP · 5')

  // 구간 안에는 그 프로젝트 행만.
  const hrRows = await page.getByTestId('ai-project-HR').locator('[data-testid^="ai-row-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid')).filter((t) => /^ai-row-\d+$/.test(t ?? '')),
  )
  expect(hrRows).toEqual(['ai-row-1012', 'ai-row-1015'])

  // 에픽 묶음은 프로젝트 구간 안에서 그대로 — 머리 아래 하위 행이 이어진다.
  const wp = page.getByTestId('ai-project-WP')
  await expect(wp.getByTestId('ai-epic-412')).toBeVisible()
  const wpOrder = await wp.locator('[data-testid^="ai-row-"], [data-testid^="ai-epic-"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-testid')).filter((t) => /^ai-(row|epic)-\d+$/.test(t ?? '')))
  expect(wpOrder).toEqual(['ai-epic-412', 'ai-row-413', 'ai-row-414', 'ai-row-418', 'ai-row-430'])
})

// WP-450: 다음 회차 대기 — 칩이 SCHEDULED 로 요청하고, 행은 배지 + 예정 시각 라벨을 최근 보고 앞에 둔다.
// 기준 시각은 고정(2026-10-18 14:30 KST) — 「내일 09:00 이후」가 실행 시각과 무관하게 같다.
test('다음 회차 대기 칩은 SCHEDULED 로 요청하고, 행은 배지와 예정 시각을 최근 보고 앞에 보인다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date(KST_1430))
  const rows = [
    createScheduledIssue(601, '주간 리포트 생성', { note: '다른 작업에 양보했어요' }),
    createScheduledIssue(602, '로그 정리', { note: '예정 없이 양보', nextRunAt: null }),
  ]
  const { list } = await setup(page, rows, createAiTaskCounts({ all: 5, scheduled: 2 }))
  await page.goto('/me/ai-tasks')
  await list.waitForRequest()
  await expect(page.getByTestId('ai-quick-count-scheduled')).toHaveText('2')

  await page.getByTestId('ai-quick-scheduled').click()
  await expect(page).toHaveURL(/[?&]state=SCHEDULED/)
  await expect(page.getByTestId('ai-quick-scheduled')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => list.lastRequest()?.searchParams.get('agentState')).toBe('SCHEDULED')

  await expect(page.getByTestId('ai-row-601-state')).toHaveText('다음 회차 대기')
  const next = page.getByTestId('ai-row-601-next-run')
  await expect(next).toHaveText('내일 09:00 이후')
  await expect(next).toHaveAttribute('title', '예정 2026-10-19 09:00')
  await expect(page.getByTestId('ai-row-601-note')).toHaveText('다른 작업에 양보했어요')
  // 예정 라벨이 최근 보고보다 앞(왼쪽)에 놓인다.
  const nb = (await next.boundingBox())!
  const tb = (await page.getByTestId('ai-row-601-note').boundingBox())!
  expect(nb.x + nb.width).toBeLessThanOrEqual(tb.x + 0.5)
  // 예정 시각이 없으면 라벨만 있고 title 은 없다.
  await expect(page.getByTestId('ai-row-602-next-run')).toHaveText('다른 작업 뒤 이어서')
  await expect(page.getByTestId('ai-row-602-next-run')).not.toHaveAttribute('title', /.+/)
  // 다른 상태 행에는 예정 라벨이 없다.
  await expect(page.getByTestId('ai-row-412-next-run')).toHaveCount(0)
})

// WP-917: 좁은 폭 접기 — 표 래퍼(@container) 폭에 따라 에이전트 유형(60.25rem 미만) → 진행률(53.25rem 미만) 순으로 숨기고
// 제목 칸 15rem 을 지킨다. 1024 미만은 모바일 목록이라 표 단언은 1024px 이상에서만 한다.
const PROGRESS_ROW = createIssue({
  id: 440, number: 440, title: '대시보드 위젯 드래그 정렬', status: 'IN_PROGRESS', assignees: [agent],
  agentWork: [createAgentWork({ worker: agent, state: 'WORKING', note: '드래그 핸들 구현 중', progress: 64 })],
})
const REM = 16

/** 보이는(display≠none) 헤더 셀 텍스트 — sr-only 칸은 빈 글자로 센다. */
async function visibleHeads(page: Page) {
  return page.getByTestId('ai-tasks-table').locator('thead th').evaluateAll((els) =>
    els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => (e.textContent ?? '').trim()))
}

/** 행의 보이는 칸 수 — colSpan 을 반영한다(에픽 머리 줄의 앞 4칸 합침). */
async function visibleCellCount(page: Page, testId: string) {
  return page.getByTestId(testId).locator('td').evaluateAll((els) =>
    els.filter((e) => getComputedStyle(e).display !== 'none').reduce((n, e) => n + (e as HTMLTableCellElement).colSpan, 0))
}

async function tableWidth(page: Page) {
  return page.getByTestId('ai-tasks-table').evaluate((el) => el.getBoundingClientRect().width)
}

test.describe('AI 위임 작업 좁은 폭 접기 @1440px', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test('1440에서 10개 헤더가 모두 보인다', async ({ authenticatedPage: page }) => {
    await setup(page, [...ROWS, PROGRESS_ROW])
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-440')).toBeVisible()
    const heads = await visibleHeads(page)
    expect(heads).toHaveLength(10)
    expect(heads).toEqual(expect.arrayContaining(['ID', '제목', 'AI 진행', '최근 보고', '진행률', '담당자', '에이전트 유형', '마지막 보고']))
    // 넓은 폭 — 진행률은 제 칸, AI 진행 배지는 suffix 없이.
    await expect(page.getByTestId('ai-row-440-state')).toBeVisible()
    await expect(page.getByTestId('ai-row-440-state')).toContainText('작업 중')
    await expect(page.getByTestId('ai-row-440-state')).not.toContainText('%')
    await expect(page.getByTestId('ai-row-440-state-compact')).toBeHidden()
  })

  test('앱 레일을 펼쳐도 제목 칸이 240px 이상', async ({ authenticatedPage: page }) => {
    await setup(page, [...ROWS, PROGRESS_ROW])
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-412')).toBeVisible()
    await page.getByTestId('rail-toggle').click()
    await expect(page.getByTestId('rail-collapse')).toBeVisible()
    await expect.poll(async () => (await page.getByTestId('ai-row-412').locator('td').nth(3).boundingBox())!.width).toBeGreaterThanOrEqual(240)
  })
})

test.describe('AI 위임 작업 좁은 폭 접기 @1280px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  test('1280에서도 에이전트 유형·진행률 헤더가 보인다', async ({ authenticatedPage: page }) => {
    await setup(page, [...ROWS, PROGRESS_ROW])
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-440')).toBeVisible()
    const heads = await visibleHeads(page)
    expect(heads).toContain('에이전트 유형')
    expect(heads).toContain('진행률')
  })
})

test.describe('AI 위임 작업 좁은 폭 접기 @1024px', () => {
  test.use({ viewport: { width: 1024, height: 800 } })

  // 1024 기본 배치(레일 접힘·목록 224px)의 표 폭은 712px — 3단계(최근 보고 5.5rem)까지 접어 제목 15rem 을 지킨다.
  test('1024에서 제목 칸 폭이 240px 이상', async ({ authenticatedPage: page }) => {
    await setup(page, [...ROWS, PROGRESS_ROW])
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-412')).toBeVisible()
    const box = (await page.getByTestId('ai-row-412').locator('td').nth(3).boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(240)
    // 줄어든 최근 보고는 한 줄 말줄임 + 전체는 title.
    const note = page.getByTestId('ai-row-412-note')
    await expect(note).toHaveCSS('text-overflow', 'ellipsis')
    await expect(note).toHaveAttribute('title', '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?')
  })

  test('앱 레일을 펼친 1024에서도 묶음 하위 행 제목은 칸 안에서 말줄임된다', async ({ authenticatedPage: page }) => {
    await setup(page, GROUPED_ROWS)
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-413')).toBeVisible()
    await page.getByTestId('rail-toggle').click()
    await expect(page.getByTestId('rail-collapse')).toBeVisible()
    const link = page.getByTestId('ai-row-413').getByRole('link', { name: '결제 실패 재시도 정책' })
    const cell = page.getByTestId('ai-row-413').locator('td').nth(3)
    await expect.poll(async () => {
      const l = (await link.boundingBox())!
      const c = (await cell.boundingBox())!
      return l.x + l.width <= c.x + c.width + 0.5 // 링크가 제목 칸 안(옆 AI 진행 칸을 덮지 않음)
    }).toBe(true)
    const m = await link.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, to: getComputedStyle(el).textOverflow }))
    if (m.sw > m.cw) expect(m.to).toBe('ellipsis')
  })

  test('1024에서 에이전트 유형이 숨고 담당자 툴팁에 유형이 있다', async ({ authenticatedPage: page }) => {
    await setup(page, [...ROWS, PROGRESS_ROW])
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-412')).toBeVisible()
    expect(await visibleHeads(page)).not.toContain('에이전트 유형')
    await expect(page.getByTestId('ai-row-412-tool')).toBeHidden()
    await expect(page.getByTestId('ai-row-412-assignee')).toHaveAttribute('title', `${agent.name} (에이전트) · Claude Code`)
    // 도구를 모르는 행(시작 전)은 이름만.
    await expect(page.getByTestId('ai-row-420-assignee')).toHaveAttribute('title', `${agent.name} (에이전트)`)
  })

  test('좁으면 진행률이 AI 진행 배지에 합쳐진다', async ({ authenticatedPage: page }) => {
    await setup(page, [...ROWS, PROGRESS_ROW])
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-row-440')).toBeVisible()
    if ((await tableWidth(page)) < 53.25 * REM) {
      await expect(page.getByTestId('ai-row-440-state-compact')).toBeVisible()
      await expect(page.getByTestId('ai-row-440-state-compact')).toContainText('작업 중 64%')
      await expect(page.getByTestId('ai-row-440-state')).toBeHidden()
      expect(await visibleHeads(page)).not.toContain('진행률')
      // 진행 정보가 없는 행은 좁은 배지에도 suffix 가 없다.
      await expect(page.getByTestId('ai-row-416-state-compact')).toContainText('인증 필요')
      await expect(page.getByTestId('ai-row-416-state-compact')).not.toContainText('%')
      // 가장 긴 합친 배지(「검토 필요 100%」)도 AI 진행 칸 밖(최근 보고 칸)으로 넘치지 않는다.
      await expect(page.getByTestId('ai-row-415-state-compact')).toContainText('검토 필요 100%')
      const badge = (await page.getByTestId('ai-row-415-state-compact').boundingBox())!
      const cell = (await page.getByTestId('ai-row-415').locator('td').nth(4).boundingBox())!
      expect(badge.x + badge.width).toBeLessThanOrEqual(cell.x + cell.width)
    } else {
      await expect(page.getByTestId('ai-row-440-state')).toBeVisible()
      await expect(page.getByTestId('ai-row-440-state-compact')).toBeHidden()
      expect(await visibleHeads(page)).toContain('진행률')
    }
  })

  test('에픽 머리 줄의 보이는 칸 수 = 보이는 헤더 수', async ({ authenticatedPage: page }) => {
    await setup(page, GROUPED_ROWS)
    await page.goto('/me/ai-tasks')
    await expect(page.getByTestId('ai-epic-412')).toBeVisible()
    const heads = (await visibleHeads(page)).length
    expect(heads).toBeLessThan(10)
    expect(await visibleCellCount(page, 'ai-epic-412')).toBe(heads) // 에픽 자신 AI 작업이 있는 머리
    expect(await visibleCellCount(page, 'ai-epic-420')).toBe(heads) // AI 칸이 빈 머리
    expect(await visibleCellCount(page, 'ai-row-413')).toBe(heads)
  })
})

test('헤더 셀은 text-xs·font-normal', async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('ai-row-412')).toBeVisible()
  const styles = await page.getByTestId('ai-tasks-table').locator('thead th').evaluateAll((els) =>
    els.map((e) => ({ weight: getComputedStyle(e).fontWeight, size: getComputedStyle(e).fontSize })))
  for (const s of styles) expect(s).toEqual({ weight: '400', size: '12px' })
})

test('완료 칩 0건은 「아직 완료된 AI 작업이 없습니다」이고 필터 초기화가 없다', async ({ authenticatedPage: page }) => {
  await setup(page, [], createAiTaskCounts())
  await page.goto('/me/ai-tasks?state=DONE')
  const empty = page.getByTestId('ai-row-empty')
  await expect(empty).toContainText('아직 완료된 AI 작업이 없습니다')
  await expect(empty).toContainText('AI가 작업을 끝내면 여기에 최근 종료순으로 쌓여요.')
  await expect(empty.locator('svg')).toBeVisible()
  await expect(page.getByTestId('ai-empty-reset')).toHaveCount(0)

  // 완료 칩 + facet 이 함께 걸려 0건이면 조건 문구 + 필터 초기화를 유지한다.
  await page.goto('/me/ai-tasks?state=DONE&priority=HIGH')
  await expect(empty).toContainText('조건에 맞는 AI 작업이 없어요')
  await expect(page.getByTestId('ai-empty-reset')).toBeVisible()
})
