// 월 뷰 오버플로 — 셀 높이만큼 이벤트를 채우고 넘칠 때만 +N 표시.
// 기존엔 셀 높이와 무관하게 무조건 3개 고정 → 큰 화면에서 공간 낭비 + 과도한 +N.
import type { CalendarEvent } from '../../../src/types/calendar'
import { calendarEvent } from '../../factories/calendar.factory'
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

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

test(
  '큰 화면 — 셀 높이만큼 3개 초과로 채워진다 (하드캡 회귀 방지)',
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
    const visible = await chips.count()
    expect(visible).toBeGreaterThan(3)
  },
)

test('작은 화면 — 넘치는 만큼 +N 이 정확히 표시된다', async ({ authenticatedPage: page }) => {
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
  const visible = await chips.count()

  // +N 표시가 존재하고, 그 숫자는 (전체 10 - 보이는 개수) 와 정확히 일치해야 한다.
  const overflowText = await cell.getByText(/^\+\d+$/).textContent()
  expect(overflowText).toBe(`+${10 - visible}`)
})

test(
  '이벤트가 셀을 채워도 마감 이슈 마커가 잘리지 않는다 (마커 공간 예약)',
  async ({ authenticatedPage: page }) => {
    // 큰 화면 + 같은 날 이벤트 9건 + 마감 이슈 1건. 마커 예약이 없으면
    // 이벤트가 셀을 꽉 채워 마커가 overflow-hidden 밖으로 밀려 사라진다.
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
    const dueChip = cell.getByTestId('calendar-issue-due-7')
    await expect(dueChip).toBeVisible()

    // 마커 하단이 셀 경계 안에 있어야 한다(클립되지 않음).
    const dueBox = await dueChip.boundingBox()
    const cellBox = await cell.boundingBox()
    expect(dueBox).not.toBeNull()
    expect(cellBox).not.toBeNull()
    expect(dueBox!.y + dueBox!.height).toBeLessThanOrEqual(cellBox!.y + cellBox!.height)
  },
)
