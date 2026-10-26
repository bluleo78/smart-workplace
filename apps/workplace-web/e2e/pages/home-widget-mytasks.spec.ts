import type { Page } from '@playwright/test'

import { createIssue, createIssueSearchResponse } from '../factories/issue.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// 홈 "내 작업" 위젯 E2E — 홈 → 위젯 → 이슈 상세 배선(@wiring) 1건만 남긴다(WP-971).
// 그룹 헤더 → 필터 조회 주소, 빈 상태·구독 변동 라인, 한쪽 조회 5xx → 오류+재시도는
// 화면 테스트 src/components/home/widgets/dashboard/myTasksBody.test.tsx 가 지킨다.

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

// 버킷 순서·중복 제거·미시작 TODO 행·대기 건수는 myTasks.test.ts(buildMyTaskRows)가 담당 — 여기선 위젯 연결·이동만 본다.
test('행 클릭 시 이슈 상세로 이동한다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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
