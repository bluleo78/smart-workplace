import type { Page } from '@playwright/test'

import type { IssueSearchResponse } from '../../../src/types/issue'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { createLabel, toLabelSummary } from '../../factories/label.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { DESKTOP_WIDTHS, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'

// 내 작업 페이지(3탭) E2E — 실제 브라우저가 필요한 것만 남긴다.
// 탭별 조회 파라미터·탭 이동·잘못된 탭 바로잡기·facet 칩·아이콘·aria-controls 패널·프로젝트 묶음 머리·레이블 +N·행 클릭 이동·
// 마감 지남·완료 모두 보기·실패·로딩·필터 0건·데이터 없음 상태는 src/pages/me/myTasksPage.test.tsx(vitest 화면 테스트)가 지킨다.
// 여기에는 /me/tasks → 할당 탭 대표 흐름(@wiring)과 헤더 정렬·배지 한 줄·행 높이·ID 헤더 x 맞춤(@layout)만 둔다.

// 라우트 → 페이지 → API → 화면 대표 흐름 — /me/tasks 는 할당 탭으로 넘어가고 assignee=me 결과를 행으로 그린다.
test('내 작업 — /me/tasks 는 할당 탭으로 넘어가 assignee=me 로 조회하고 결과를 렌더한다', { tag: '@wiring' }, async ({
  authenticatedPage: page,
}) => {
  const cap = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([createIssue({ id: 11, title: '할당된 이슈' })]),
    { capture: true },
  )
  await page.goto('/me/tasks')
  await expect(page).toHaveURL(/\/me\/tasks\/assigned$/)

  const req = await cap.waitForRequest()
  expect(req.searchParams.get('assignee')).toBe('me')
  await expect(page.getByTestId('assigned-row-11')).toContainText('할당된 이슈')
})

// 페이지 레이아웃 통합(Page) — 내 작업도 h-14 헤더 바를 갖고, 헤더 제목·탭·필터 바가 같은 시작선에 선다(넓은 화면 포함).
for (const width of DESKTOP_WIDTHS) {
  test.describe(`내 작업 헤더 바 @${width}px`, { tag: '@layout' }, () => {
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

test('내 작업 — 긴 제목이어도 유형 배지는 한 줄로 유지된다(WP-630)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

// ── WP-916 데스크톱: 한 줄 행 ─────────────────────────────
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

test.describe('내 작업 데스크톱 묶음(WP-916)', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('행은 한 줄이다 — 긴 제목·레이블 5개 행도 레이블 없는 행과 높이가 같다', async ({ authenticatedPage: page }) => {
    await routeMeIssues(page, () => createIssueSearchResponse(twoProjectItems()))
    await page.goto('/me/tasks/assigned')
    const tall = (await page.getByTestId('assigned-row-52').boundingBox())!.height
    const plain = (await page.getByTestId('assigned-row-53').boundingBox())!.height
    expect(Math.abs(tall - plain)).toBeLessThanOrEqual(1)
  })
})

// WP-919 — ID 헤더 글자가 키 글자(유형 아이콘 뒤) 시작과 같은 x 에 온다. 프로젝트 목록과 같은 LIST_ID_HEAD_INDENT_CLASS 를 쓴다.
test('내 작업 — ID 헤더 글자가 키 글자와 2px 이내로 맞는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
