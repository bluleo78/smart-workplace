// 모바일 내 작업·AI 위임 작업 스모크(페이지 레이아웃 통합) — 390px 에서 제목 h1 한 번, 목록 행 노출,
// Page.Body 스크롤 영역이 실제로 스크롤되어 뒤쪽 행이 보이는지 확인한다(헤더 바를 빼도 본문 스크롤이 살아 있어야 함).
import type { Page } from '@playwright/test'

import { createAiTaskCounts } from '../../factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import type { UserSummary } from '../../../src/types/user'

const agent: UserSummary = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' }
// 한 화면(844px)을 넘기도록 충분히 많은 행.
const ISSUES = Array.from({ length: 30 }, (_, i) =>
  createIssue({ id: 100 + i, title: `모바일 작업 ${i + 1}`, assignees: [agent] }),
)
const LAST_ID = 100 + ISSUES.length - 1

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

test('내 작업 — 제목 h1 한 번, 행 노출, 본문 스크롤로 마지막 행까지 보인다', async ({ authenticatedPage: page }) => {
  await setup(page, '/me/tasks/assigned')
  await expectSmoke(page, '내 작업', 'assigned-row')
})

test('내 작업 — 표 대신 모바일 행: 긴 제목이 폭을 쓰고 메타 줄은 한 줄(WP-630)', async ({ authenticatedPage: page }) => {
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

test('모바일 메타 — 우선순위는 높음·매우 높음만 빨간 글자로, 매우 낮음은 숨긴다(WP-886)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 301, number: 31, title: '결제 장애', priority: 'HIGHEST', assignees: [agent] }),
      createIssue({ id: 302, number: 32, title: '로그인 오류', priority: 'HIGH', assignees: [agent] }),
      createIssue({ id: 303, number: 33, title: '아이디어', priority: 'LOWEST', assignees: [agent] }),
    ]),
  )
  await page.goto('/me/tasks/assigned')
  const highest = page.getByTestId('assigned-row-301-meta').getByText('매우 높음', { exact: true })
  await expect(highest).toBeVisible()
  await expect(highest).toHaveClass(/text-destructive/)
  await expect(page.getByTestId('assigned-row-302-meta').getByText('높음', { exact: true })).toHaveClass(/text-destructive/)
  await expect(page.getByTestId('assigned-row-303-meta')).toBeVisible()
  await expect(page.getByTestId('assigned-row-303-meta')).not.toContainText('낮음')
})

test('AI 위임 작업 — 제목 h1 한 번, 행 노출, 본문 스크롤로 마지막 행까지 보인다', async ({ authenticatedPage: page }) => {
  await setup(page, '/me/ai-tasks')
  await expectSmoke(page, 'AI 위임 작업', 'ai-row')
})

// ── WP-916 모바일: 프로젝트 머리 줄·담당자 표시·마감 지남·행 탭 ─────────────────────────
const human: UserSummary = { id: 7, username: 'kim', name: '김민수', kind: 'HUMAN' }
const EX = { name: '외부 연동 프로젝트', size: 2 }
const OPS = { name: '운영 개선', size: 1 }
const GROUPED = [
  createIssue({ id: 301, projectKey: 'EX', number: 31, title: '외부 연동 첫 작업', assignees: [human], projectGroup: EX }),
  createIssue({ id: 302, projectKey: 'EX', number: 32, title: '외부 연동 둘째 작업', assignees: [human], projectGroup: EX }),
  createIssue({ id: 303, projectKey: 'OPS', number: 5, title: '운영 작업', assignees: [human], projectGroup: OPS }),
]

test('내 작업 — 프로젝트 머리 줄이 그 프로젝트 행 위에 있다(WP-916)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(GROUPED))
  await page.goto('/me/tasks/assigned')
  const exHead = page.getByTestId('assigned-row-project-EX-head')
  const opsHead = page.getByTestId('assigned-row-project-OPS-head')
  await expect(exHead).toContainText(EX.name)
  await expect(opsHead).toContainText(OPS.name)
  const y = async (tid: string) => (await page.getByTestId(tid).boundingBox())!.y
  expect(await y('assigned-row-project-EX-head')).toBeLessThan(await y('assigned-row-301'))
  expect(await y('assigned-row-302')).toBeLessThan(await y('assigned-row-project-OPS-head'))
  expect(await y('assigned-row-project-OPS-head')).toBeLessThan(await y('assigned-row-303'))
  await expectNoHorizontalOverflow(page)
})

test('내 작업 — 할당 탭은 아바타가 없고 구독 탭은 있다(WP-916)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(GROUPED))
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse(GROUPED))
  await page.goto('/me/tasks/assigned')
  await expect(page.getByTestId('assigned-row-301')).toBeVisible()
  await expect(page.getByTestId('assigned-row-301').getByTestId(/^user-avatar/)).toHaveCount(0)
  await page.getByTestId('tab-watched').click()
  await expect(page.getByTestId('watched-row-301')).toBeVisible()
  await expect(page.getByTestId('watched-row-301').getByTestId(/^user-avatar/)).not.toHaveCount(0)
})

test('내 작업 — 마감 지남은 빨강(WP-916)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-10-24T10:00:00'))
  await stubChat(page)
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 401, projectKey: 'EX', number: 41, title: '지난 마감', dueDate: '2026-10-20', projectGroup: EX }),
      createIssue({ id: 402, projectKey: 'EX', number: 42, title: '끝난 일', status: 'DONE', dueDate: '2026-10-20', projectGroup: EX }),
    ]),
  )
  await page.goto('/me/tasks/assigned?closed=all')
  const overdue = page.getByTestId('assigned-row-401-due')
  await expect(overdue).toHaveClass(/text-destructive/)
  await expect(overdue).toContainText('10월 20일')
  await expect(overdue).toContainText('마감 지남')
  const done = page.getByTestId('assigned-row-402-due')
  await expect(done).not.toHaveClass(/text-destructive/)
  await expect(done).not.toContainText('마감 지남')
})

test('내 작업 — 행 탭으로 상세 이동(WP-916)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(GROUPED))
  await page.goto('/me/tasks/assigned')
  // 제목 링크가 아닌 메타 줄을 눌러도 행 전체 탭으로 상세로 간다.
  await page.getByTestId('assigned-row-301-meta').click()
  await expect(page).toHaveURL(/\/projects\/EX\/issues\/31/)
})
