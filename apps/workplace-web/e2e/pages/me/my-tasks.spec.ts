import type { Page } from '@playwright/test'

import type { IssueSearchResponse } from '../../../src/types/issue'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { createLabel, toLabelSummary } from '../../factories/label.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
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

// ── WP-916 데스크톱: 프로젝트 묶음·한 줄 행·완료 토글 ─────────────────────────────
// /me/issues 는 group=due|recent 로 프로젝트 묶음 순서로 주고 행마다 projectGroup{name,size} 를 싣는다(WP-915).

const EX = { name: '외부 연동 프로젝트', size: 7 }
const OPS = { name: '운영 개선', size: 2 }
const labels = (n: number) => Array.from({ length: n }, (_, i) => toLabelSummary(createLabel({ id: 900 + i, name: `레이블${i + 1}` })))

/** 두 프로젝트(EX·OPS)에 걸친 기본 응답 — 52번은 긴 제목·레이블 5개, 53번은 레이블 0개. */
function twoProjectItems() {
  return [
    createIssue({ id: 52, projectKey: 'EX', number: 52, title: '긴 제목 '.repeat(30).trim(), labels: labels(5), projectGroup: EX }),
    createIssue({ id: 53, projectKey: 'EX', number: 53, title: '짧은 제목', projectGroup: EX }),
    createIssue({ id: 61, projectKey: 'OPS', number: 61, title: '운영 이슈', projectGroup: OPS }),
  ]
}

/** /me/issues 목 — 요청 URL 을 모두 기록하고, 응답은 쿼리별로 고른다. */
async function routeMeIssues(page: Page, respond: (sp: URLSearchParams) => IssueSearchResponse) {
  const seen: URLSearchParams[] = []
  await page.route(
    (url) => url.pathname === '/api/v1/me/issues',
    (route) => {
      const sp = new URL(route.request().url()).searchParams
      seen.push(sp)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(sp)) })
    },
  )
  return seen
}

test.describe('내 작업 데스크톱 묶음(WP-916)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('할당 탭 요청은 group=due 와 hideClosed=true 를 보낸다', async ({ authenticatedPage: page }) => {
    const seen = await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    await expect(page.getByTestId('assigned-row-52')).toBeVisible()
    expect(seen[0].get('assignee')).toBe('me')
    expect(seen[0].get('group')).toBe('due')
    expect(seen[0].get('hideClosed')).toBe('true')
  })

  test('행은 한 줄이다 — 긴 제목·레이블 5개 행도 레이블 없는 행과 높이가 같다', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    const tall = (await page.getByTestId('assigned-row-52').boundingBox())!.height
    const plain = (await page.getByTestId('assigned-row-53').boundingBox())!.height
    expect(Math.abs(tall - plain)).toBeLessThanOrEqual(1)
  })

  test('레이블은 2개 + +3', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    const meta = page.getByTestId('assigned-row-52-labels')
    await expect(meta).toBeVisible()
    await expect(meta.getByText(/^레이블\d$/)).toHaveCount(2)
    await expect(meta).toContainText('+3')
  })

  test('할당 탭에는 담당자 열이 없고 내가 만든 탭에는 있다', async ({ authenticatedPage: page }) => {
    const seen = await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    await expect(page.getByTestId('assigned-row-52')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '담당자' })).toHaveCount(0)
    await page.getByTestId('tab-reported').click()
    await expect(page.getByTestId('reported-row-52')).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '담당자' })).toHaveCount(1)
    const reported = seen.find((sp) => sp.get('reporter') === 'me')!
    expect(reported.get('group')).toBe('recent')
    expect(reported.get('hideClosed')).toBeNull()
  })

  test('프로젝트 머리 줄은 이름·서버 건수를 보이고 두 페이지에 이어져도 한 번만', async ({ authenticatedPage: page }) => {
    // 1페이지 끝과 2페이지 처음이 같은 프로젝트(EX) — 2페이지 첫 행은 1페이지 마지막 행(53)의 중복.
    await routeMeIssues(page, (sp) =>
      sp.get('cursor')
        ? createIssueSearchResponse([
            createIssue({ id: 53, projectKey: 'EX', number: 53, title: '짧은 제목', projectGroup: EX }),
            createIssue({ id: 54, projectKey: 'EX', number: 54, title: '2페이지 이슈', projectGroup: EX }),
            createIssue({ id: 61, projectKey: 'OPS', number: 61, title: '운영 이슈', projectGroup: OPS }),
          ])
        : createIssueSearchResponse(twoProjectItems().slice(0, 2), 'g1:opaque'),
    )
    await page.goto('/me/tasks/assigned')
    await expect(page.getByTestId('assigned-row-54')).toBeVisible()
    await expect(page.locator('[data-testid$="-project-EX-head"]')).toHaveCount(1)
    await expect(page.getByTestId('assigned-row-project-EX-head-name')).toHaveText(EX.name)
    await expect(page.getByTestId('assigned-row-project-EX-head-count')).toHaveText(`EX · ${EX.size}`)
    await expect(page.getByTestId('assigned-row-53')).toHaveCount(1)
    await expect(page.getByTestId('assigned-row-project-OPS').getByTestId('assigned-row-61')).toBeVisible()
  })

  test('행 빈 곳을 누르면 상세로 간다', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    await page.getByTestId('assigned-row-52-due').click()
    await expect(page).toHaveURL(/\/projects\/EX\/issues\/52/)
  })

  test('마감 지남은 빨강·sr-only, 완료 행은 아니다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-10-24T10:00:00'))
    await routeMeIssues(page, () =>
      createIssueSearchResponse([
        createIssue({ id: 71, projectKey: 'EX', number: 71, title: '지난 마감', dueDate: '2026-10-20', projectGroup: EX }),
        createIssue({ id: 72, projectKey: 'EX', number: 72, title: '끝난 일', status: 'DONE', dueDate: '2026-10-20', projectGroup: EX }),
      ]),
    )
    await page.goto('/me/tasks/assigned')
    const overdue = page.getByTestId('assigned-row-71-due')
    await expect(overdue).toHaveClass(/text-destructive/)
    await expect(overdue).toContainText('10월 20일')
    await expect(overdue).toContainText('마감 지남')
    const done = page.getByTestId('assigned-row-72-due')
    await expect(done).not.toHaveClass(/text-destructive/)
    await expect(done).not.toContainText('마감 지남')
  })

  test('완료 모두 보기를 켜면 closed=all 과 hideClosed 없이 다시 부른다', async ({ authenticatedPage: page }) => {
    const seen = await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    const toggle = page.getByTestId('show-all-closed-toggle')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.click()
    await expect(page).toHaveURL(/closed=all/)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => seen.at(-1)?.get('hideClosed') ?? 'none').toBe('none')
    expect(seen.at(-1)?.get('group')).toBe('due')
  })

  test('할당 탭 상태=완료 필터는 숨김을 풀어 완료 행을 보인다', async ({ authenticatedPage: page }) => {
    // 서버 흉내 — hideClosed=true 면 완료 행을 빼고 준다.
    const done = createIssue({ id: 81, projectKey: 'EX', number: 81, title: '완료한 일', status: 'DONE', projectGroup: EX })
    const seen = await routeMeIssues(page, (sp) =>
      createIssueSearchResponse(sp.get('hideClosed') === 'true' ? [] : [done]),
    )
    await page.goto('/me/tasks/assigned?status=DONE')
    await expect(page.getByTestId('assigned-row-81')).toBeVisible()
    expect(seen.at(-1)?.get('status')).toBe('DONE')
    expect(seen.at(-1)?.get('hideClosed')).toBeNull()
    // 상태를 직접 골라 숨김이 이미 풀렸으므로 토글은 눌린 채 비활성.
    await expect(page.getByTestId('show-all-closed-toggle')).toBeDisabled()
  })

  test('내가 만든 탭에는 완료 모두 보기 토글이 없다', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/reported')
    await expect(page.getByTestId('reported-row-52')).toBeVisible()
    await expect(page.getByTestId('show-all-closed-toggle')).toHaveCount(0)
  })
})

// ── WP-916 상태 화면: 실패·로딩·필터 0건·데이터 없음을 서로 다르게 보인다 ─────────────────
test.describe('내 작업 상태 화면(WP-916)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('첫 페이지 500이면 실패 안내와 다시 시도, 빈 상태가 아니다', async ({ authenticatedPage: page }) => {
    let failing = true
    await page.route(
      (url) => url.pathname === '/api/v1/me/issues',
      (route) =>
        failing
          ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) })
          : route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(createIssueSearchResponse(twoProjectItems())),
            }),
    )
    await page.goto('/me/tasks/assigned')
    const error = page.getByTestId('assigned-row-error')
    await expect(error).toContainText('작업을 불러오지 못했습니다')
    await expect(page.getByTestId('assigned-row-empty')).toHaveCount(0)
    failing = false
    await page.getByTestId('assigned-row-error-retry').click()
    await expect(page.getByTestId('assigned-row-52')).toBeVisible()
    await expect(error).toHaveCount(0)
  })

  test('불러오는 동안 스켈레톤', async ({ authenticatedPage: page }) => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    await page.route(
      (url) => url.pathname === '/api/v1/me/issues',
      async (route) => {
        await gate
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueSearchResponse(twoProjectItems())),
        })
      },
    )
    await page.goto('/me/tasks/assigned')
    await expect(page.locator('[aria-busy="true"]')).toBeVisible()
    release()
    await expect(page.getByTestId('assigned-row-52')).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  })

  test('필터 0건은 초기화 버튼, 누르면 status 쿼리가 사라진다', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, (sp) => createIssueSearchResponse(sp.get('status') ? [] : twoProjectItems()))
    await page.goto('/me/tasks/assigned?status=IN_PROGRESS&priority=HIGH')
    const empty = page.getByTestId('assigned-row-empty')
    await expect(empty).toContainText('조건에 맞는 작업이 없습니다')
    await expect(empty).toContainText('할당된 작업은 있지만 필터에 걸러졌습니다')
    await page.getByTestId('assigned-row-empty-reset').click()
    await expect(page).toHaveURL((u) => u.pathname === '/me/tasks/assigned' && !u.searchParams.has('status') && !u.searchParams.has('priority'))
    await expect(page.getByTestId('assigned-row-52')).toBeVisible()
  })

  test('내가 만든 탭의 필터 0건 설명은 내가 만든 작업 문구다', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, () => createIssueSearchResponse([]))
    await page.goto('/me/tasks/reported?status=DONE')
    await expect(page.getByTestId('reported-row-empty')).toContainText('내가 만든 작업은 있지만 필터에 걸러졌습니다')
  })

  test('데이터 없음(필터 없음)은 「완료 모두 보기」 안내', async ({ authenticatedPage: page }) => {
    const seen = await routeMeIssues(page, () => createIssueSearchResponse([]))
    await page.goto('/me/tasks/assigned')
    const empty = page.getByTestId('assigned-row-empty')
    await expect(empty).toContainText('할당된 작업이 없습니다')
    await expect(empty).toContainText('완료한 작업은 「완료 모두 보기」로 볼 수 있습니다')
    await expect(page.getByTestId('assigned-row-empty-reset')).toHaveCount(0)
    await page.getByTestId('assigned-row-empty-show-closed').click()
    await expect(page).toHaveURL(/closed=all/)
    await expect.poll(() => seen.at(-1)?.get('hideClosed') ?? 'none').toBe('none')
  })
})

// WP-919 — ID 헤더 글자가 키 글자(유형 아이콘 뒤) 시작과 같은 x 에 온다. 프로젝트 목록과 같은 LIST_ID_HEAD_INDENT_CLASS 를 쓴다.
test('내 작업 — ID 헤더 글자가 키 글자와 2px 이내로 맞는다', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 31, number: 31, title: '줄 맞춤 이슈' })]),
  )
  await page.goto('/me/tasks/assigned')
  const key = page.getByTestId('assigned-row-31').getByText('WP-31', { exact: true })
  await expect(key).toBeVisible()
  // 글자 시작점은 Range 로 잰다 — 셀 상자 x 는 패딩(들여쓰기)을 포함한다.
  const textLeft = (el: Element) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().x
  }
  const headX = await page.getByRole('columnheader', { name: 'ID', exact: true }).evaluate(textLeft)
  const keyX = await key.evaluate(textLeft)
  expect(Math.abs(headX - keyX)).toBeLessThanOrEqual(2)
})
