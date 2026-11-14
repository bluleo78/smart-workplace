// WP-1557 — 주·일 보기를 열면 시간 그리드가 늘 0시부터 보여 지금 시각을 찾아 내려야 했다.
// 오늘이 든 기간이면 지금보다 1시간 위부터, 오늘이 없는 기간이면 오전 8시부터 보이고, 오늘 열에 현재 시각 선이 보인다.
// 스크롤 위치·보이는 영역은 jsdom 이 재현할 수 없어 @layout. 선이 오늘 열에만 있고 위치가 맞는지는 calendarPage.test.tsx 가 본다.
// 오늘이 든 기간으로 돌아오면 다시 지금 근처로, 오늘이 없는 기간으로 옮기면 보던 위치를 지킨다.
// 셸 전환 때 위치를 지키는 것은 calendar-scroll-resize.spec.ts(WP-1488)가 본다.
import type { Locator } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'

// 기대 시각을 로컬 시각으로 고정하려고 KST 로 둔다.
test.use({ timezoneId: 'Asia/Seoul' })

const HOUR_SLOT_PX = 48

/** 기대 scrollTop — 그리드가 더 내려갈 수 없으면(창이 낮아 최대 스크롤보다 큰 값) 브라우저가 최대값으로 자른다. */
async function expectedScrollTop(grid: Locator, want: number): Promise<number> {
  return grid.evaluate((el, w) => Math.min(w, el.scrollHeight - el.clientHeight), want)
}

test.describe('주·일 보기 처음 스크롤과 현재 시각 선', { tag: '@layout' }, () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/calendar/events'),
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
  })

  test('오늘이 든 주는 지금보다 1시간 위부터 보이고 현재 시각 선이 보인다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T00:30:00Z')) // 2026-06-10(수) 09:30 KST
    await page.goto('/calendar')
    await page.getByTestId('calendar-view-week-btn').click()
    const week = page.getByTestId('calendar-view-week')
    await expect(week).toBeVisible()

    const grid = week.locator('div.overflow-auto')
    const want = await expectedScrollTop(grid, 8.5 * HOUR_SLOT_PX)
    expect(want).toBeGreaterThan(0)
    await expect.poll(() => grid.evaluate((el, w) => Math.abs(el.scrollTop - w), want)).toBeLessThanOrEqual(2)
    await expect(week.getByTestId('calendar-grid-now')).toBeInViewport()
  })

  test('다른 주로 옮겼다가 「오늘」로 돌아오면 다시 지금보다 1시간 위로 스크롤한다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T00:30:00Z')) // 2026-06-10(수) 09:30 KST
    await page.goto('/calendar')
    await page.getByTestId('calendar-view-week-btn').click()
    const week = page.getByTestId('calendar-view-week')
    await expect(week).toBeVisible()
    const grid = week.locator('div.overflow-auto')
    const want = await expectedScrollTop(grid, 8.5 * HOUR_SLOT_PX)
    await expect.poll(() => grid.evaluate((el, w) => Math.abs(el.scrollTop - w), want)).toBeLessThanOrEqual(2)

    // 사용자가 2시 무렵으로 올려 둔 뒤 오늘이 없는 다음 주로 — 보던 위치를 지키고 8시로 다시 맞추지 않는다.
    // (최대 스크롤 근처 값은 오늘 배지 유무로 헤더 높이가 바뀌어 잘릴 수 있어, 여유 있는 위치로 잰다)
    await grid.evaluate((el, y) => {
      el.scrollTop = y
    }, 2 * HOUR_SLOT_PX)
    await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(2 * HOUR_SLOT_PX)
    await page.getByTestId('calendar-next').click()
    await expect(week.getByTestId('calendar-grid-now')).toHaveCount(0)
    await expect.poll(() => grid.evaluate((el) => Math.abs(el.scrollTop - 2 * 48))).toBeLessThanOrEqual(2)

    // 맨 위로 올린 뒤 「오늘」을 누르면 이번 주로 돌아와 지금 시각 근처로 다시 내려간다
    await grid.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(0)
    await page.getByTestId('calendar-today').click()
    await expect(week.getByTestId('calendar-grid-now')).toHaveCount(1)
    await expect.poll(() => grid.evaluate((el, w) => Math.abs(el.scrollTop - w), want)).toBeLessThanOrEqual(2)
    await expect(week.getByTestId('calendar-grid-now')).toBeInViewport()
  })

  test('오후 늦은 시각에도 현재 시각 선이 보이는 영역 안에 있다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T08:30:00Z')) // 17:30 KST — 최대 스크롤에 가까운 시각
    await page.goto('/calendar')
    await page.getByTestId('calendar-view-day-btn').click()
    const day = page.getByTestId('calendar-view-day')
    await expect(day).toBeVisible()

    const grid = day.locator('div.overflow-auto')
    const want = await expectedScrollTop(grid, 16.5 * HOUR_SLOT_PX)
    await expect.poll(() => grid.evaluate((el, w) => Math.abs(el.scrollTop - w), want)).toBeLessThanOrEqual(2)
    await expect(day.getByTestId('calendar-grid-now')).toBeInViewport()
  })

  test('오늘이 없는 기간을 새로 열면 오전 8시부터 보인다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T05:30:00Z')) // 14:30 KST
    await page.goto('/calendar')
    await page.getByTestId('calendar-view-week-btn').click()
    const week = page.getByTestId('calendar-view-week')
    await expect(week).toBeVisible()
    // 다음 주로 옮긴 뒤 일 보기로 바꾸면(다른 보기라 새로 마운트) 오늘이 없는 날을 연다
    await page.getByTestId('calendar-next').click()
    await page.getByTestId('calendar-view-day-btn').click()
    const day = page.getByTestId('calendar-view-day')
    await expect(day).toBeVisible()
    await expect(day.getByTestId('calendar-grid-now')).toHaveCount(0)

    const grid = day.locator('div.overflow-auto')
    const want = await expectedScrollTop(grid, 8 * HOUR_SLOT_PX)
    await expect.poll(() => grid.evaluate((el, w) => Math.abs(el.scrollTop - w), want)).toBeLessThanOrEqual(2)
    await expect(day.getByText('8:00', { exact: true })).toBeInViewport()
  })
})
