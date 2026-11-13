// 월 뷰 오버플로 — 셀 높이만큼 이벤트를 채우고 넘칠 때만 +N 표시.
// 기존엔 셀 높이와 무관하게 무조건 3개 고정 → 큰 화면에서 공간 낭비 + 과도한 +N.
// 셀 높이 측정·잘림은 jsdom 이 잴 수 없어 모두 @layout(WP-966).
import type { Locator, Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import { calendarEvent } from '../../factories/calendar.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { measureBox } from '../../fixtures/wait'

// 지정 날짜에 몰린 일정 N건 (id 10~). 월 뷰 한 셀에 모두 걸린다.
function crowdedDay(day = '2026-06-10', count = 10): CalendarEvent[] {
  return Array.from({ length: count }, (_, i) =>
    calendarEvent({
      id: 10 + i,
      title: `일정${i + 1}`,
      startsAt: `${day}T01:00:00Z`,
      endsAt: `${day}T02:00:00Z`,
    }),
  )
}

// 날짜 칸 안의 일정·마감 이슈 칩
const CHIP_SELECTOR = '[data-testid^="calendar-event-"], [data-testid^="calendar-issue-due-"]'
// 2026년 6월 월 보기의 6주째 마지막 칸
const LAST_CELL_TESTID = 'calendar-cell-2026-07-11'

// 칸 안의 보이는 항목 하단이 모두 칸 경계 안에 있는지(클립되지 않음).
// 칸 높이 측정으로 개수가 자리 잡을 때까지 측정+단언을 재시도한다 (WP-225)
async function expectItemsInsideCell(cell: Locator, items: Locator) {
  await expect(async () => {
    const cellBox = await measureBox(cell)
    const count = await items.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i++) {
      const box = await measureBox(items.nth(i))
      expect(box.y + box.height).toBeLessThanOrEqual(cellBox.y + cellBox.height)
    }
  }).toPass()
}

// 6주의 마지막 칸이 월 보기 틀 안에 보이는지
async function expectLastCellInside(page: Page, month: Locator) {
  await expect(async () => {
    const monthBox = await measureBox(month)
    const lastBox = await measureBox(page.getByTestId(LAST_CELL_TESTID))
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(monthBox.y + monthBox.height + 1)
    expect(lastBox.y).toBeGreaterThanOrEqual(monthBox.y)
  }).toPass()
}

test(
  '큰 화면 — 셀 높이만큼 3개 초과로 채워진다 (하드캡 회귀 방지)',
  { tag: '@layout' },
  async ({ authenticatedPage: page }) => {
    // 세로로 긴 뷰포트 → 셀이 높아져 4개 이상 들어갈 공간 확보
    await page.setViewportSize({ width: 1280, height: 1600 })
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    await page.route(
      (url) => url.pathname.startsWith('/api/v1/calendar/events'),
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(crowdedDay()) }),
    )

    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-view-month')).toBeVisible()

    // 해당 셀에 렌더된 이벤트 칩 수 — 기존 코드라면 정확히 3개에서 멈춘다.
    const cell = page.getByTestId('calendar-cell-2026-06-10')
    const chips = cell.locator('[data-testid^="calendar-event-"]')
    await expect(chips.first()).toBeVisible()
    // 셀 높이 측정 후 채움 개수가 정해지므로, 첫 칩이 보인 직후가 아니라 자리 잡을 때까지 다시 센다 (WP-225)
    await expect.poll(() => chips.count()).toBeGreaterThan(3)
  },
)

test('작은 화면 — 넘치는 만큼 +N 이 정확히 표시된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 세로가 짧은 뷰포트 → 셀이 낮아 일부만 보이고 나머지는 +N
  await page.setViewportSize({ width: 1280, height: 640 })
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(crowdedDay()) }),
  )

  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-month')).toBeVisible()

  const cell = page.getByTestId('calendar-cell-2026-06-10')
  const chips = cell.locator('[data-testid^="calendar-event-"]')
  await expect(chips.first()).toBeVisible()

  // +N 표시가 존재하고, 그 숫자는 (전체 10 - 보이는 개수) 와 정확히 일치해야 한다.
  // 셀 높이 측정으로 개수가 다시 정해지는 동안 두 값이 어긋날 수 있어 함께 재시도한다 (WP-225)
  await expect(async () => {
    const visible = await chips.count()
    await expect(cell.getByText(/^\+\d+$/)).toHaveText(`+${10 - visible}`, { timeout: 1000 })
  }).toPass()
})

test(
  '보이는 칩이 칸 경계에 잘리지 않는다 (마감 이슈 포함)',
  { tag: '@layout' },
  async ({ authenticatedPage: page }) => {
    // 큰 화면 + 같은 날 이벤트 9건 + 마감 이슈 1건. 마감 이슈도 일정과 합쳐 칸을 채우고
    // 넘치면 「+N」 으로 들어가므로 특정 마감 칩이 보이는지는 묻지 않는다.
    // 의도는 「보이는 칩(일정·마감 이슈)은 칸 경계에 잘리지 않는다」.
    await page.setViewportSize({ width: 1280, height: 1600 })
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    await mockApi(page, 'GET', '/api/v1/calendar/events', crowdedDay('2026-06-12', 9))
    await mockApi(
      page,
      'GET',
      '/api/v1/me/issues',
      createIssueSearchResponse([
        createIssue({ id: 7, projectKey: 'WP', number: 42, title: '로그인 버그', status: 'IN_PROGRESS', dueDate: '2026-06-12' }),
      ]),
    )

    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-view-month')).toBeVisible()

    const cell = page.getByTestId('calendar-cell-2026-06-12')
    const chips = cell.locator(CHIP_SELECTOR)
    await expect(chips.first()).toBeVisible()

    // 보이는 모든 칩의 하단이 칸 경계 안에 있어야 한다(클립되지 않음).
    await expectItemsInsideCell(cell, chips)
  },
)

// ── WP-1541: 한 날짜에 마감 이슈가 몰려도 6주가 화면 안에 들어오고, 낮은 창에서는 스크롤로 닿는다 ──

// 6월 12일에 일정 1건 + 마감 이슈 9건(id 100~)이 몰린 데이터를 모킹한다.
async function mockCrowdedDueDay(page: Page) {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await mockApi(page, 'GET', '/api/v1/calendar/events', crowdedDay('2026-06-12', 1))
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse(
      Array.from({ length: 9 }, (_, i) =>
        createIssue({
          id: 100 + i,
          projectKey: 'WP',
          number: 100 + i,
          title: `마감 이슈${i + 1}`,
          status: 'IN_PROGRESS',
          dueDate: '2026-06-12',
        }),
      ),
    ),
  )
}

test(
  '보통 창 + 한 날 마감 이슈 다수 — 6주가 월 보기 안에 들어오고 스크롤이 없다',
  { tag: '@layout' },
  async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1288, height: 717 })
    await mockCrowdedDueDay(page)
    await page.goto('/calendar')
    const month = page.getByTestId('calendar-view-month')
    await expect(month).toBeVisible()

    const cell = page.getByTestId('calendar-cell-2026-06-12')
    const chips = cell.locator(CHIP_SELECTOR)
    await expect(chips.first()).toBeVisible()

    // 측정으로 칩 수가 자리 잡을 때까지 재시도 (WP-225)
    await expect(async () => {
      const monthBox = await measureBox(month)
      const lastBox = await measureBox(page.getByTestId(LAST_CELL_TESTID))
      expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(monthBox.y + monthBox.height + 1)
      expect(await month.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
      // 「+N」 = 전체 10건 − 보이는 칩(일정 + 마감)
      const visible = await chips.count()
      await expect(cell.getByTestId('calendar-more-2026-06-12')).toHaveText(`+${10 - visible}`, { timeout: 1000 })
    }).toPass()
  },
)

test(
  '낮은 창 — 월 보기를 끝까지 스크롤하면 마지막 주가 보이고 칩이 칸 경계에 잘리지 않는다',
  { tag: '@layout' },
  async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1288, height: 480 })
    await mockCrowdedDueDay(page)
    await page.goto('/calendar')
    const month = page.getByTestId('calendar-view-month')
    await expect(month).toBeVisible()

    await expect
      .poll(() => month.evaluate((el) => el.scrollHeight - el.clientHeight))
      .toBeGreaterThan(0)

    // 끝까지 스크롤
    await month.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect.poll(() => month.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    // 요일 줄은 sticky — 스크롤 뒤에도 틀의 top 에 붙어 있다
    const weekdayRow = month.locator('> :first-child')
    await expect(async () => {
      const monthBox = await measureBox(month)
      const rowBox = await measureBox(weekdayRow)
      expect(Math.abs(rowBox.y - monthBox.y)).toBeLessThanOrEqual(1)
    }).toPass()

    // 마지막 칸이 틀 안에 보인다
    await expectLastCellInside(page, month)

    // 6월 12일 칸의 보이는 칩·「+N」 이 칸 아래 끝을 넘지 않는다
    const cell = page.getByTestId('calendar-cell-2026-06-12')
    await expectItemsInsideCell(cell, cell.locator(`${CHIP_SELECTOR}, [data-testid^="calendar-more-"]`))
  },
)

test.describe('모바일 월 보기', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test(
    '모바일 월 보기 — 마감 이슈가 몰려도 마지막 주까지 닿는다',
    { tag: '@layout' },
    async ({ authenticatedPage: page }) => {
      await mockCrowdedDueDay(page)
      await page.goto('/calendar')
      // 모바일 기본은 목록 — 보기 선택으로 월 보기로 바꾼다
      await page.getByTestId('calendar-view-select').selectOption('month')
      const month = page.getByTestId('calendar-view-month')
      await expect(month).toBeVisible()

      await month.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      await expectLastCellInside(page, month)

      // 문서 가로 넘침 없음
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflowX).toBeLessThanOrEqual(0)
    },
  )
})
