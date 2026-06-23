// 홈 합성 위젯 신선도 회귀 — 이슈 마감일을 변경하면 "오늘 마감" KPI 가 즉시 갱신되어야 한다.
// (useUpdateIssue 가 ['my-issue-dues'] 를 무효화하지 않으면, SPA 내 복귀 시 위젯이 stale 한 채로 남는다.)
// 입력(마감일 지우기 PATCH) → 처리(my-issue-dues 무효화) → 출력(KPI 0건) 전 파이프라인 검증.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi } from '../fixtures/api-mock'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'
import { createProject } from '../factories/project.factory'
import type { DashboardLayout } from '../../src/types/dashboard'

const PROJECT_KEY = 'WP'
const ISSUE_NUMBER = 7
const DETAIL_PATH = `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`

// 오늘(yyyy-MM-dd, 로컬) — '오늘 마감' 후보가 되도록.
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function layout(widgets: string[]): DashboardLayout {
  return { widgets: widgets.map((w) => ({ type: w, count: 5, hidden: false })) }
}

// /me/issues(useMyIssueDues 소스)와 이슈 상세 GET/PATCH 를 공유 상태(currentDueDate)로 스텁한다.
async function setup(page: Page) {
  let currentDueDate: string | null = todayKey()

  // useMyIssueDues 소스 — 가변 dueDate 반영. dueDate 가 null 이면 빈 목록.
  await page.route(
    (url) => url.pathname === '/api/v1/me/issues',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const items = currentDueDate
        ? [createIssue({ id: 1, projectKey: PROJECT_KEY, number: ISSUE_NUMBER, title: '오늘 마감 이슈', dueDate: currentDueDate })]
        : []
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(items)),
      })
    },
  )

  // 이슈 상세 진입 스텁(프로젝트/멤버/보조 엔드포인트).
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  )
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `${DETAIL_PATH}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
  }
  // 이슈 상세 GET — 가변 dueDate.
  await page.route(
    (url) => url.pathname === DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: 1, projectKey: PROJECT_KEY, number: ISSUE_NUMBER, title: '오늘 마감 이슈', dueDate: currentDueDate }),
          }),
        ),
      })
    },
  )
  // PATCH — clearDueDate 처리 후 공유 상태 갱신.
  await page.route(
    (url) => url.pathname === DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      const payload = route.request().postDataJSON() as Record<string, unknown>
      if (payload.clearDueDate === true) currentDueDate = null
      if (typeof payload.dueDate === 'string') currentDueDate = payload.dueDate
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ id: 1, projectKey: PROJECT_KEY, number: ISSUE_NUMBER, dueDate: currentDueDate })),
      })
    },
  )

  await mockApi(page, 'GET', '/api/v1/me/dashboard', layout(['my_tasks']))
}

test('합성 신선도 — 마감일을 지우면 "오늘 마감" KPI 가 즉시 0건이 된다 (my-issue-dues 무효화)', async ({
  authenticatedPage: page,
}) => {
  await setup(page)
  await page.goto('/')

  const counts = page.getByTestId('dashboard-counts')
  // (초기) 오늘 마감 1건.
  await expect(counts.getByRole('link', { name: '오늘 마감 1건' })).toBeVisible()

  // SPA 내 클라이언트 내비게이션으로 이슈 상세 진입(전체 리로드 금지 — queryClient 보존).
  await page.getByTestId('dashboard-attention-focus').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}$`))

  // 마감일 지우기(PATCH {clearDueDate:true}).
  await expect(page.getByTestId('due-date-clear')).toBeVisible()
  await page.getByTestId('due-date-clear').click()
  await expect(page.getByTestId('due-date-trigger')).toContainText('없음')

  // 홈으로 클라이언트 복귀(history back → popstate, 리로드 없음).
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)

  // (출력) 무효화로 my-issue-dues 가 refetch → 오늘 마감 0건. 수정 전엔 stale(1건)로 실패.
  await expect(counts.getByRole('link', { name: '오늘 마감 0건' })).toBeVisible()
  await expect(counts.getByRole('link', { name: '오늘 마감 1건' })).toHaveCount(0)
})
