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
