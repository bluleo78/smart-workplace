// 모바일 내 작업·AI 위임 작업 스모크(페이지 레이아웃 통합) — 390px 에서 제목 h1 한 번, 목록 행 노출,
// Page.Body 스크롤 영역이 실제로 스크롤되어 뒤쪽 행이 보이는지 확인한다(헤더 바를 빼도 본문 스크롤이 살아 있어야 함).
// 기하(스크롤·행 폭)만 남긴다(@layout). 우선순위 메타 문구·색, 프로젝트 머리 줄 순서, 할당/구독 아바타, 마감 지남, 행 탭 이동은
// 페이지 테스트 src/pages/mobile/mobileMeTasks.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test'

import { createAiTaskCounts } from '../../factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectBodyNoHorizontalOverflow, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import type { MyWorkflowTurn } from '../../../src/lib/workflowRuns'
import type { UserSummary } from '../../../src/types/user'

const agent: UserSummary = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' }
// 한 화면(844px)을 넘기도록 충분히 많은 행.
const ISSUES = Array.from({ length: 30 }, (_, i) =>
  createIssue({ id: 100 + i, title: `모바일 작업 ${i + 1}`, assignees: [agent] }),
)
const LAST_ID = 100 + ISSUES.length - 1

/** 내 차례 목 — 건수 배지가 탭 폭을 키워 탭 줄 넘침을 확실히 만든다(WP-2045 리뷰 후속 2: 넘침 전제를 강제). */
function turnList(count: number): { items: MyWorkflowTurn[] } {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      runId: 500 + i,
      issueId: 400 + i,
      issueNumber: 40 + i,
      issueKey: `WP-${40 + i}`,
      title: `내 차례 일 ${i + 1}`,
      projectId: 1,
      projectKey: 'WP',
      workflowId: 1,
      workflowName: '버그 대응',
      versionNo: 1,
      nodeKey: 'review',
      nodeName: '검토',
      enteredAt: '2026-11-01T09:00:00+09:00',
      handedBy: null,
      question: null,
      asking: false,
    })),
  }
}

/** 활성 탭이 탭 줄 래퍼의 좌·우 경계 안에 다 들어와 있는가 — 잘리면 음수 여유를 낸다. */
async function activeTabSlack(page: Page) {
  return page.getByRole('tablist').evaluate((list) => {
    const wrapper = list.parentElement as HTMLElement
    const trigger = list.querySelector('[role=tab][data-state="active"]') as HTMLElement
    const w = wrapper.getBoundingClientRect()
    const t = trigger.getBoundingClientRect()
    return Math.round(Math.min(t.left - w.left, w.right - t.right))
  })
}

/** 탭 줄 래퍼가 실제로 넘치는가 — 넘치지 않으면 잘릴 일이 없어 회귀 단언이 가짜 안전이 되니 전제로 단언한다(WP-2045 리뷰 후속 2). */
async function expectTabStripOverflows(page: Page) {
  const { scrollWidth, clientWidth } = await page.getByRole('tablist').evaluate((el) => {
    const w = el.parentElement!
    return { scrollWidth: w.scrollWidth, clientWidth: w.clientWidth }
  })
  expect(scrollWidth, `탭 줄 넘침 전제 — scrollWidth ${scrollWidth} / clientWidth ${clientWidth}`).toBeGreaterThan(clientWidth)
}

async function setup(page: Page, path: string) {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(ISSUES))
  // AI 위임 작업은 전용 조회(/me/ai-tasks + 칩 건수 counts, WP-377).
  await mockApi(page, 'GET', '/api/v1/me/ai-tasks', createIssueSearchResponse(ISSUES))
  await mockApi(page, 'GET', '/api/v1/me/ai-tasks/counts', createAiTaskCounts({ all: ISSUES.length }))
  await page.goto(path)
}

/** 제목 h1 이 한 번만 있고, 첫 행이 보이며, 본문 스크롤 영역을 내리면 마지막 행이 보인다. */
async function expectSmoke(page: Page, title: string, rowPrefix: string) {
  await expect(page.getByRole('heading', { level: 1, name: title })).toHaveCount(1)
  await expect(page.getByTestId(`${rowPrefix}-100`)).toBeVisible()
  const last = page.getByTestId(`${rowPrefix}-${LAST_ID}`)
  await expect(last).not.toBeInViewport()
  const body = page.getByTestId('page-body')
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await expect(last).toBeInViewport()
  await expectNoHorizontalOverflow(page)
}

test('내 작업 — 제목 h1 한 번, 행 노출, 본문 스크롤로 마지막 행까지 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page, '/me/tasks/assigned')
  await expectSmoke(page, '내 작업', 'assigned-row')
})

test('내 작업 — 표 대신 모바일 행: 긴 제목이 폭을 쓰고 메타 줄은 한 줄(WP-630)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const long = '모바일에서 아주 긴 제목이 글자 단위로 접히지 않고 화면 폭을 다 써야 한다 '.repeat(3).trim()
  await stubChat(page)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 200, number: 7, title: long, priority: 'HIGH', assignees: [agent] })]),
  )
  await page.goto('/me/tasks/assigned')
  const title = page.getByTestId('assigned-row-200-title')
  await expect(title).toBeVisible()
  // 표 칸(w-32/w-28/w-24)에 눌려 한두 글자씩 접히던 회귀 — 제목이 행 폭 대부분을 쓴다.
  expect((await title.boundingBox())!.width).toBeGreaterThan(250)
  expect((await title.boundingBox())!.height).toBeLessThan(48) // line-clamp-2
  const meta = page.getByTestId('assigned-row-200-meta')
  await expect(meta).toContainText('WP-7')
  await expect(meta).toContainText('높음')
  expect((await meta.boundingBox())!.height).toBeLessThan(24)
  await expect(page.locator('thead')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('AI 위임 작업 — 제목 h1 한 번, 행 노출, 본문 스크롤로 마지막 행까지 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page, '/me/ai-tasks')
  await expectSmoke(page, 'AI 위임 작업', 'ai-row')
})

// WP-2045: 탭 줄(5개)이 390px 을 넘치면 그 넘침이 본문 스크롤 상자로 전파돼 「내 차례」 탭 선택 때
// 페이지 전체가 가로로 밀렸다(제목 왼쪽 여백 소실). 탭 줄이 자기 상자 안에서만 밀려야 한다(@layout).
test('내 작업 — 「내 차례」 탭을 눌러도 본문 스크롤 상자가 가로로 밀리지 않는다(WP-2045)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse([createIssue({ id: 300 })]))
  // 넘침 전제를 스스로 만든다 — 배지가 없는 탭 줄은 390px 에서 2px 안팎만 넘쳐 글꼴·패딩 차이로 전제가 깨졌다(WP-2045 리뷰 후속 2).
  await mockApi(page, 'GET', '/api/v1/me/workflow-turns', turnList(12))
  await page.goto('/me/tasks/watched')
  await expect(page.getByTestId('tab-turns')).toBeVisible()

  const title = page.getByRole('heading', { level: 1, name: '내 작업' })
  const leftBefore = (await title.boundingBox())!.x
  await expectBodyNoHorizontalOverflow(page)

  await page.getByTestId('tab-turns').click()
  await expect(page).toHaveURL(/\/me\/tasks\/turns$/)

  // 패널이 그려지고 목록이 나온 뒤에 좌표를 잰다 — 그 전에 읽으면 패널 교체·목록 로드 뒤의 늦은 스크롤을 놓친다
  // (WP-2045 리뷰 후속 3). 이후 좌표도 계속 같은지 폴로 확인한다.
  await expect(page.getByTestId('my-turn-list')).toBeVisible()
  await expectBodyNoHorizontalOverflow(page)
  await expect.poll(async () => (await title.boundingBox())!.x).toBe(leftBefore)

  // 탭 줄 자체는 넘쳐도 자기 상자 안에서만 밀린다.
  await expectTabStripOverflows(page)

  // 활성 탭 밑줄(TabsTrigger 의 after)이 래퍼(overflow-x-auto)의 세로 클립 경계 밖으로 잘리지 않는다 —
  // 래퍼는 overflow-y 를 auto 로 계산해 자기 상자만 그리는데, 밑줄은 TabsList 상자 아래로 1.5px 나간다(WP-2045 판정).
  // 밑줄 하단 y = trigger 패딩 박스 하단 - bottom(음수면 밖으로) / 잘림 경계 = 래퍼 패딩 박스 하단(top + border + clientHeight).
  const clip = await page.getByRole('tablist').evaluate((list) => {
    const wrapper = list.parentElement as HTMLElement
    const trigger = list.querySelector('[role=tab][data-state="active"]') as HTMLElement
    const after = getComputedStyle(trigger, '::after')
    const triggerBorder = parseFloat(getComputedStyle(trigger).borderBottomWidth)
    const underlineBottomY = trigger.getBoundingClientRect().bottom - triggerBorder - parseFloat(after.bottom)
    const box = wrapper.getBoundingClientRect()
    const clipY = box.top + parseFloat(getComputedStyle(wrapper).borderTopWidth) + wrapper.clientHeight
    return { underlineBottomY, clipY }
  })
  expect(clip.underlineBottomY, `밑줄 하단 ${clip.underlineBottomY} vs 래퍼 경계 ${clip.clipY}`).toBeLessThanOrEqual(clip.clipY)
})

// WP-2045 리뷰 후속 1: 주소로 /me/tasks/turns 에 바로 들어오면(링크·새로고침) 래퍼가 scrollLeft 0 이라
// 오른쪽 끝의 활성 탭(건수 배지 포함)이 잘려 보인다 — 활성 탭은 래퍼 안에 다 보여야 한다(@layout).
test('내 작업 — 주소로 「내 차례」에 바로 들어와도 활성 탭이 탭 줄 안에 다 보인다(WP-2045)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/workflow-turns', turnList(12))
  await page.goto('/me/tasks/turns')
  await expect(page.getByTestId('tab-turns')).toBeVisible()
  // 목록이 나온 뒤(배지가 붙은 뒤)에 잰다 — 그 전에는 탭이 덜 넓어 잘렸는지 알 수 없다.
  await expect(page.getByTestId('my-turn-list')).toBeVisible()
  // 이 테스트만 단독으로 돌 때도 넘침 전제가 서 있어야 한다 — 넘치지 않으면 활성 탭이 잘릴 일이 없다(WP-2045 리뷰 후속 2).
  await expectTabStripOverflows(page)

  await expect.poll(() => activeTabSlack(page)).toBeGreaterThanOrEqual(0)
  // 잘리는 동안 페이지 본문이 가로로 밀리지 않았는지도 함께 본다(WP-2045 원 증상).
  await expectBodyNoHorizontalOverflow(page)
  // 왼쪽 여백이 그대로인가 — 원 증상(14px 밀림)이 다시 나오면 16px 이 아니라 1~2px 로 준다.
  const title = page.getByRole('heading', { level: 1, name: '내 작업' })
  expect((await title.boundingBox())!.x).toBeGreaterThanOrEqual(16)
})
