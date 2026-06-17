import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'

// 내 작업 페이지(3탭) E2E — 할당/내가 만든 탭이 올바른 쿼리파라미터로 /me/issues 를 조회하고
// 결과를 렌더하는지, 탭 클릭으로 경로가 바뀌는지 검증.
// 캡처 API: mockApi(..., { capture: true }) → cap.waitForRequest() 가 { url: URL, searchParams } 반환.
// (url 은 string 이 아닌 URL 객체이므로 query 검증은 searchParams.get() 으로 한다.)

test('내 작업 — 할당 탭은 assignee=me 로 조회하고 결과를 렌더한다', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 11, title: '할당된 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks/assigned')

  const req = await cap.waitForRequest()
  expect(req.searchParams.get('assignee')).toBe('me')
  await expect(page.getByTestId('assigned-row-11')).toContainText('할당된 이슈')
  // #201 회귀 — 공유 테이블은 기본 showAssignees=false → 내 작업 뷰에는 담당자 컬럼이 없다.
  await expect(page.getByRole('columnheader', { name: '담당자' })).toHaveCount(0)
})

test('내 작업 — 내가 만든 탭은 reporter=me 로 조회한다', async ({ authenticatedPage: page }) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 22, title: '내가 만든 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks/reported')

  const req = await cap.waitForRequest()
  expect(req.searchParams.get('reporter')).toBe('me')
  await expect(page.getByTestId('reported-row-22')).toContainText('내가 만든 이슈')
})

test('내 작업 — 탭 클릭으로 경로가 바뀐다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([]))
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse([]))
  await page.goto('/me/tasks/assigned')
  await page.getByTestId('tab-reported').click()
  await expect(page).toHaveURL(/\/me\/tasks\/reported$/)
})

test('내 작업 — 잘못된 탭은 할당 탭으로 폴백 렌더된다', async ({ authenticatedPage: page }) => {
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 55, title: '폴백 할당 이슈' })]),
  )
  await page.goto('/me/tasks/bogus')
  // 잘못된 탭이어도 할당 탭 내용(assignee=me 결과)이 렌더된다.
  await expect(page.getByTestId('assigned-row-55')).toContainText('폴백 할당 이슈')
})

test('내 작업 — /me/tasks 는 할당 탭으로 리다이렉트된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([]))
  await page.goto('/me/tasks')
  await expect(page).toHaveURL(/\/me\/tasks\/assigned$/)
})

// #233-B — 공통 facet 필터(상태/우선순위). 정적 enum 만 노출하며 /me/issues query 로 합쳐진다.
// 캡처 helper 의 waitForRequest 는 마지막 캡처를 즉시 반환하므로(초기 unfiltered 요청),
// facet 적용 후에는 expect.poll(lastRequest) 로 새 요청이 도착할 때까지 기다린다.
test('내 작업 — 상태 facet 을 선택하면 status query 로 조회하고 칩이 보인다 (할당 탭 유지)', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 11, title: '할당된 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks/assigned')
  // 초기 요청은 assignee=me, status 없음.
  await cap.waitForRequest()
  expect(cap.lastRequest()?.searchParams.get('status')).toBeNull()

  // ＋필터 → 상태 → 진행 중 선택.
  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-status').click()
  await page.getByTestId('facet-value-status-IN_PROGRESS').click()

  // 새 요청이 status=IN_PROGRESS + assignee=me 로 도착할 때까지 대기.
  await expect
    .poll(() => cap.lastRequest()?.searchParams.get('status'))
    .toBe('IN_PROGRESS')
  expect(cap.lastRequest()?.searchParams.get('assignee')).toBe('me')
  // 탭은 경로 세그먼트라 facet 변경에도 유지된다.
  await expect(page).toHaveURL(/\/me\/tasks\/assigned/)
  // 칩 노출.
  await expect(page.getByTestId('filter-chip-status')).toBeVisible()

  // 칩 제거 → URL 의 status param 이 사라지고 칩도 사라진다.
  // (이전 unfiltered 쿼리키는 캐시되어 새 네트워크 요청이 없을 수 있으므로 URL/칩으로 검증.)
  await page.getByTestId('filter-chip-status-remove').click()
  await expect(page).toHaveURL((u) => !u.searchParams.has('status'))
  await expect(page.getByTestId('filter-chip-status')).toHaveCount(0)
})

test('내 작업 — 우선순위 facet 을 선택하면 priority query 로 조회한다', async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 12, title: '할당된 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks/assigned')
  await cap.waitForRequest()

  await page.getByTestId('add-filter-trigger').click()
  await page.getByTestId('add-filter-facet-priority').click()
  await page.getByTestId('facet-value-priority-HIGH').click()

  await expect.poll(() => cap.lastRequest()?.searchParams.get('priority')).toBe('HIGH')
  expect(cap.lastRequest()?.searchParams.get('assignee')).toBe('me')
})

// #294 회귀 — 내 작업 목록 상태·우선순위는 텍스트 배지가 아닌 아이콘으로 표시되어야 한다.
// IssueStatusIcon(role=img aria-label="상태: ...") · IssuePriorityBars(role=img aria-label="우선순위 ...") 사용 검증.
test('내 작업 — 상태·우선순위가 텍스트 배지 아닌 아이콘으로 렌더된다 (#294)', async ({
  authenticatedPage: page,
}) => {
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 77, title: '아이콘 검증 이슈', status: 'IN_PROGRESS', priority: 'HIGH' }),
    ]),
  )
  await page.goto('/me/tasks/assigned')
  await page.waitForSelector('[data-testid="assigned-row-77"]')

  const row = page.getByTestId('assigned-row-77')

  // 아이콘 방식: svg role=img + aria-label/title 확인.
  await expect(row.getByRole('img', { name: /상태:/ })).toBeVisible()
  await expect(row.getByRole('img', { name: /우선순위/ })).toBeVisible()

  // 텍스트 배지 방식이 사라졌는지 확인(regression guard).
  await expect(row.getByText('진행 중')).toHaveCount(0)
  await expect(row.getByText('높음')).toHaveCount(0)
})
