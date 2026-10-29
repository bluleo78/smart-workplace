// AI 위임 작업(WP-377) — 범위(나와 관련/전체)·빠른 필터 칩·AI 진행 표.
// 조회는 /me/ai-tasks(목록)·/me/ai-tasks/counts(칩 건수) 서버 조건으로 하고, 화면은 서버 순서를 그대로 그린다.
// 무소식 툴팁·범위/빠른 필터 칩 → URL·요청·칩 건수·완료 칩 배지 톤·빈/조건 빈 상태·필터 초기화·「AI 배정하기」 이동·
// 첫 페이지 실패·다음 페이지 이어 붙이기·에픽/프로젝트 묶음 구조·다음 회차 대기는 src/pages/me/aiTasksPage.test.tsx(vitest 화면 테스트)가 지킨다.
// 여기에는 대표 행 구조(@wiring), 다시 시도 초점(@input), 헤더 정렬·표 넘침·좁은 폭 접기·들여쓰기·글자 크기(@layout)만 둔다.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { agentWorker as agent, createAgentWork, createAiTaskCounts, minutesAgo } from '../../factories/agentWork.factory'
import { createAiAgentsResponse, createAiAgentStatus, createAiAgentWork } from '../../factories/aiAgent.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { GROUPED_ROWS } from '../../fixtures/ai-tasks-groups'
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

test('행에 AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고를 서버 순서대로 보인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
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

// WP-893: 다시 시도로 부르는 동안 안내가 「불러오는 중」으로 바뀌면 초점이 body 로 빠진다 — 안내·버튼이 남아(aria-disabled) 초점을 지킨다.
test('첫 페이지 실패 뒤 다시 시도 — 부르는 동안·다시 실패해도 초점이 다시 시도에 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  let failing = true
  let release: () => void = () => {}
  let held: Promise<void> = Promise.resolve()
  await mockApi(page, 'GET', COUNTS, createAiTaskCounts())
  await page.route(
    (url) => url.pathname === LIST,
    async (route) => {
      await held
      return failing
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(ROWS)) })
    },
  )
  await page.goto('/me/ai-tasks')
  const retry = page.getByTestId('ai-tasks-error-retry')
  await retry.focus()

  // 다시 부르는 중 — 안내와 버튼이 그대로, 버튼은 잠김 표시만.
  held = new Promise<void>((r) => (release = r))
  await page.keyboard.press('Enter')
  await expect(retry).toHaveAttribute('aria-disabled', 'true')
  await expect(retry).toBeFocused()
  await expect(page.locator('[aria-busy="true"][data-testid="list-loading-skeleton"]')).toHaveCount(0)

  // 다시 실패 — 초점은 여전히 다시 시도.
  release()
  await expect(retry).not.toHaveAttribute('aria-disabled')
  await expect(retry).toBeFocused()

  failing = false
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('ai-row-412')).toBeVisible()
  await expect(page.getByTestId('ai-tasks-error')).toHaveCount(0)
})

// 페이지 레이아웃 — 헤더 바 안 h1·하단 56px·툴바와 같은 시작선, 표가 가로로 넘치지 않음(1280 포함 넓은 화면).
for (const width of [1280, ...DESKTOP_WIDTHS]) {
  test.describe(`AI 위임 작업 레이아웃 @${width}px`, { tag: '@layout' }, () => {
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

// 에픽 묶음(WP-375) — 하위 행 제목 칸이 들여쓰기(20px)된다(계산된 패딩은 브라우저만 잰다). 머리·하위 행 구조는 vitest.
test('에픽 묶음 하위 행 제목 칸이 20px 들여쓰기된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page, GROUPED_ROWS)
  await page.goto('/me/ai-tasks')
  const titleCell = page.getByTestId('ai-row-413').locator('td').nth(3).locator('div').first()
  await expect(titleCell).toHaveCSS('padding-left', '20px')
})

// 키·부모 제목 문구는 vitest — 여기서는 부모 제목이 폭 0 으로 숨지 않는지만 잰다.
test('묶이지 않은 행의 부모 칩 제목이 폭 0 으로 숨지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page, GROUPED_ROWS)
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('issue-row-431-parent')).toContainText('WP-377')
  // 1280 에서도 키 뒤에 부모 제목이 폭 0 으로 숨지 않고 앞 글자가 말줄임으로 보인다(제목 칸이 칩 몫을 남긴다).
  const parentTitle = page.getByTestId('issue-row-431-parent').locator('span').last()
  expect((await parentTitle.boundingBox())!.width).toBeGreaterThan(12)
  // 1440 부터는 최근 보고 칸이 넓어진다(WP-450) — 그래도 부모 제목 몫이 남는다.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(async () => (await parentTitle.boundingBox())!.width).toBeGreaterThan(12)
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

test.describe('AI 위임 작업 좁은 폭 접기 @1440px', { tag: '@layout' }, () => {
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

test.describe('AI 위임 작업 좁은 폭 접기 @1280px', { tag: '@layout' }, () => {
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

test.describe('AI 위임 작업 좁은 폭 접기 @1024px', { tag: '@layout' }, () => {
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

test('헤더 셀은 text-xs·font-normal', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.goto('/me/ai-tasks')
  await expect(page.getByTestId('ai-row-412')).toBeVisible()
  const styles = await page.getByTestId('ai-tasks-table').locator('thead th').evaluateAll((els) =>
    els.map((e) => ({ weight: getComputedStyle(e).fontWeight, size: getComputedStyle(e).fontSize })))
  for (const s of styles) expect(s).toEqual({ weight: '400', size: '12px' })
})

// AI별 보기(WP-1201) — 보기 전환 → /me/ai-agents → AI 한 줄. 행 내용·정렬·칩·필터는 aiTasksPage.test.tsx(vitest)가 지킨다.
test('AI별 보기로 바꾸면 AI 현황 API 결과가 AI 한 줄씩 보인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  const agents = await mockApi(
    page,
    'GET',
    '/api/v1/me/ai-agents',
    createAiAgentsResponse([
      createAiAgentStatus(11, 'AI 개발자1', {
        works: [createAiAgentWork({ number: 1090, title: 'AI별로 보고 싶다', state: 'INPUT_REQUIRED' })],
      }),
    ]),
    { capture: true },
  )
  await page.goto('/me/ai-tasks')
  await page.getByTestId('ai-view-agents').click()

  const row = page.getByTestId('ai-agent-11')
  await expect(row).toContainText('AI 개발자1')
  await expect(page.getByTestId('ai-agent-11-state')).toContainText('답변 필요')
  await expect(page.getByTestId('ai-agent-11-work-WP-1090')).toBeVisible()
  await expect(page).toHaveURL(/[?&]view=agents/)
  expect(agents.lastRequest()?.searchParams.get('scope')).toBe('MINE')
})
