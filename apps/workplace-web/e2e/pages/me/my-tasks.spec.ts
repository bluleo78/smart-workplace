import { expect, test } from '../../fixtures/auth.fixture'
import { mockApi } from '../../fixtures/api-mock'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { DESKTOP_WIDTHS, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'

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
  // #201 회귀 — 공유 테이블(IssueListTable)엔 담당자 컬럼이 없다(AI 위임 작업은 전용 표, WP-377).
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

  const row = page.getByTestId('assigned-row-77')
  await expect(row).toBeVisible()

  // 아이콘 방식: svg role=img + aria-label/title 확인.
  await expect(row.getByRole('img', { name: /상태:/ })).toBeVisible()
  await expect(row.getByRole('img', { name: /우선순위/ })).toBeVisible()

  // 텍스트 배지 방식이 사라졌는지 확인(regression guard).
  await expect(row.getByText('진행 중')).toHaveCount(0)
  await expect(row.getByText('높음')).toHaveCount(0)
})

// 페이지 레이아웃 통합(Page) — 내 작업도 h-14 헤더 바를 갖고, 헤더 제목·탭·필터 바가 같은 시작선에 선다(넓은 화면 포함).
for (const width of DESKTOP_WIDTHS) {
  test.describe(`내 작업 헤더 바 @${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    test('제목은 헤더 바 안 h1, 헤더 하단 56px, 탭·필터 바와 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([createIssue({ id: 11 })]))
      await page.goto('/me/tasks/assigned')
      const header = page.getByTestId('page-header')
      const title = header.getByRole('heading', { level: 1, name: '내 작업' })
      await expect(title).toBeVisible()
      // 본문에 제목이 한 번 더 그려지지 않는다(인-플로우 h1 제거).
      await expect(page.getByRole('heading', { level: 1, name: '내 작업' })).toHaveCount(1)
      await expectHeaderBottomAt56(header)
      await expectStartAligned(title, page.getByRole('tablist'))
      await expectStartAligned(title, page.getByTestId('me-task-filter-bar'))
    })
  })
}

test('내 작업 — 긴 제목이어도 유형 배지는 한 줄로 유지된다(WP-630)', async ({ authenticatedPage: page }) => {
  const long = '긴 제목 '.repeat(40).trim()
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 31, title: long })]),
  )
  await page.goto('/me/tasks/assigned')
  const row = page.getByTestId('assigned-row-31')
  await expect(row).toContainText('긴 제목')
  const badge = row.locator('[data-testid^="issue-type-badge-"]')
  // 배지 글자(「작업」)가 음절 단위로 접히면 높이가 두 줄(>20px)이 된다.
  expect((await badge.boundingBox())!.height).toBeLessThanOrEqual(20)
  expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

// WP-841 — 탭이 가리키는 패널(aria-controls)이 실제로 있어야 스크린리더가 탭과 내용을 잇는다.
test('내 작업 — 선택 탭의 aria-controls 가 그 탭으로 이름 붙은 tabpanel(목록 포함)을 가리킨다', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([createIssue({ id: 31, title: '패널 안 이슈' })]))
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', createIssueSearchResponse([createIssue({ id: 32, title: '구독 이슈' })]))
  await page.goto('/me/tasks/assigned')
  for (const [tab, row] of [['assigned', 'assigned-row-31'], ['watched', 'watched-row-32']] as const) {
    if (tab === 'watched') await page.getByTestId('tab-watched').click()
    const trigger = page.getByTestId(`tab-${tab}`)
    await expect(trigger).toHaveAttribute('aria-selected', 'true')
    const panel = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`)
    await expect(panel).toHaveAttribute('role', 'tabpanel')
    await expect(panel).toHaveAttribute('aria-labelledby', (await trigger.getAttribute('id'))!)
    await expect(panel.getByTestId(row)).toBeVisible()
  }
})
