import type { Page } from '@playwright/test'

import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// 홈 "내 작업" 위젯 격리 E2E.
// 위젯이 의존하는 두 엔드포인트 + 대시보드 레이아웃을 모킹해 입력→출력 전체 검증.

/** 내 작업 위젯 두 엔드포인트 + 레이아웃을 한 번에 모킹하는 헬퍼.
 * LIFO 라우트 우선순위 때문에 page.goto 직전에 호출한다. */
async function mockTasks(
  page: Page,
  assigned: ReturnType<typeof createIssue>[],
  watched: ReturnType<typeof createIssue>[],
) {
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse(assigned))
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse(watched))
  // 대시보드 레이아웃: my_tasks 위젯이 마운트되도록 한다.
  // auth.fixture 기본값({widgets:[]}) 보다 나중에 등록해 LIFO 로 우선 적용됨.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', {
    widgets: [{ type: 'my_tasks', count: 5, hidden: false }],
  })
}

test('그룹 헤더 클릭 시 필터링된 조회 화면으로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await mockTasks(
    page,
    [
      createIssue({ id: 1, number: 1, title: '진행 작업', status: 'IN_PROGRESS' }),
      createIssue({ id: 2, number: 2, title: '미시작 작업', status: 'TODO' }),
    ],
    [],
  )
  await page.goto('/')
  const w = page.getByTestId('dash-mytasks')
  // "진행 중" 그룹 헤더 → 진행중 필터가 걸린 할당 탭으로.
  await w.getByRole('link', { name: '진행 중 →' }).click()
  await expect(page).toHaveURL(/\/me\/tasks\/assigned\?status=IN_PROGRESS/)
})

test('막힘 그룹 헤더 클릭 시 blocked 필터 조회 화면으로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await mockTasks(page, [createIssue({ id: 5, number: 5, title: '막힌 작업', blocked: true })], [])
  await page.goto('/')
  await page.getByTestId('dash-mytasks').getByRole('link', { name: '막힘 →' }).click()
  await expect(page).toHaveURL(/\/me\/tasks\/assigned\?blocked=true/)
})

test('담당 0 + 구독 변동 → 긍정적 빈 상태와 구독 변동 라인', async ({
  authenticatedPage: page,
}) => {
  const today = new Date().toISOString()
  await mockTasks(page, [], [
    createIssue({ id: 20, number: 20, updatedAt: today }),
    createIssue({ id: 21, number: 21, updatedAt: '2026-06-01T00:00:00Z' }),
  ])
  await page.goto('/')
  const empty = page.getByTestId('dash-mytasks-empty')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('지금 손댈 일이 없어요')
  await expect(empty).toContainText('구독 중 오늘 1건 변동')
  // 헤더 부제(빈상태 div 밖)는 위젯 컨테이너에서 단언.
  await expect(page.getByTestId('dash-mytasks')).toContainText('구독 중 2건')
})

test('담당 0 + 구독 변동 없음 → 빈 상태, 변동 라인 없음', async ({
  authenticatedPage: page,
}) => {
  await mockTasks(page, [], [createIssue({ id: 30, number: 30, updatedAt: '2026-06-01T00:00:00Z' })])
  await page.goto('/')
  const empty = page.getByTestId('dash-mytasks-empty')
  await expect(empty).toBeVisible()
  await expect(empty).not.toContainText('변동')
})

// 버킷 순서·중복 제거·미시작 TODO 행·대기 건수는 myTasks.test.ts(buildMyTaskRows)가 담당 — 여기선 위젯 연결·이동만 본다.
test('행 클릭 시 이슈 상세로 이동한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockTasks(
    page,
    [createIssue({ id: 40, projectKey: 'API', number: 7, title: 'RLS 수정', status: 'IN_PROGRESS' })],
    [],
  )
  // 이슈 상세 페이지 최소 스텁 — ECONNREFUSED/frame-detached 방지.
  await mockApi(page, 'GET', '/api/v1/projects/API/issues/7', {
    summary: createIssue({ id: 40, projectKey: 'API', number: 7, title: 'RLS 수정' }),
    body: null,
    comments: [],
    history: [],
    attachments: [],
  })
  await page.goto('/')
  await page.getByTestId('dash-mytasks').getByRole('link', { name: '이슈 열기: RLS 수정' }).click()
  await expect(page).toHaveURL(/\/projects\/API\/issues\/7/)
})

test('한쪽 쿼리 5xx → WidgetError + 재시도', async ({ authenticatedPage: page }) => {
  await page.route('**/api/v1/me/issues**', (r) => r.fulfill({ status: 500, body: '{}' }))
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse([]))
  await mockApi(page, 'GET', '/api/v1/me/dashboard', {
    widgets: [{ type: 'my_tasks', count: 5, hidden: false }],
  })
  await page.goto('/')
  await expect(page.getByTestId('dash-mytasks-error')).toBeVisible()
})
