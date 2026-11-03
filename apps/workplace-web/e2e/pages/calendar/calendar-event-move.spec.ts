// 일정 끌어 옮기기(WP-1328) — 실제 마우스 끌기(@input): 포인터를 문턱 너머로 움직여 붙잡고, 다른 칸·시간 칸 위에서 놓으면
// 시각을 바꾼 수정 요청(PATCH)이 나가고 새 자리에 그려진다. 끈 뒤의 click 은 일정을 열지 않는다.
// 바디의 다른 필드·반복 범위 선택·옮길 수 없는 일정·실패 되돌림은 src/pages/calendar/calendarEventMove.test.tsx(jsdom)가 본다.
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** 일정 목록·수정을 store 하나로 모킹하고 PATCH 바디를 모은다 — 저장 뒤 다시 받은 목록이 옮긴 시각을 돌려준다. */
async function stubEvents(page: Page, store: CalendarEvent[]) {
  const patches: { url: URL; body: Partial<CalendarEvent> }[] = []
  await mockApi(page, 'GET', '/api/v1/calendars', [calendar({ id: 1 })])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store) })
      }
      if (req.method() === 'PATCH') {
        const url = new URL(req.url())
        const body = JSON.parse(req.postData() ?? '{}') as Partial<CalendarEvent>
        patches.push({ url, body })
        const id = Number(url.pathname.split('/').pop())
        const idx = store.findIndex((e) => e.id === id)
        if (idx !== -1) store[idx] = { ...store[idx], ...body }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store[idx] ?? {}) })
      }
      return route.fallback()
    },
  )
  return patches
}

/** 요소 가운데 좌표 */
async function center(page: Page, testId: string, nth = 0) {
  const box = (await page.getByTestId(testId).nth(nth).boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test.describe('일정 끌어 옮기기 (WP-1328)', { tag: '@input' }, () => {
  test('월 보기 — 일정을 이틀 뒤 칸에 끌어 놓으면 시각은 그대로 날짜만 옮겨 저장되고 그 칸에 보인다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    const original = calendarEvent({ id: 1, title: '팀 회의', startsAt: '2026-06-10T01:00:00Z', endsAt: '2026-06-10T02:00:00Z' })
    const patches = await stubEvents(page, [original])
    await page.goto('/calendar')
    const chip = page.getByTestId('calendar-cell-2026-06-10').getByTestId('calendar-event-1')
    await expect(chip).toBeVisible()

    const from = await center(page, 'calendar-event-1')
    const to = await center(page, 'calendar-cell-2026-06-12')
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    // 끄는 중 — 놓일 칸에 미리보기
    await expect(page.getByTestId('calendar-cell-2026-06-12').getByTestId('calendar-move-preview')).toHaveText('팀 회의')
    await page.mouse.up()

    await expect.poll(() => patches.length).toBe(1)
    const { url, body } = patches[0]
    expect(url.pathname).toBe('/api/v1/calendar/events/1')
    expect(body.title).toBe('팀 회의')
    expect(body.allDay).toBe(false)
    expect(body.calendarId).toBe(1)
    // 이틀 뒤 같은 시각, 길이 1시간 그대로
    expect(new Date(body.startsAt!).getTime() - new Date(original.startsAt).getTime()).toBe(2 * DAY)
    expect(new Date(body.endsAt!).getTime() - new Date(body.startsAt!).getTime()).toBe(HOUR)

    await expect(page.getByTestId('calendar-cell-2026-06-12').getByTestId('calendar-event-1')).toBeVisible()
    await expect(page.getByTestId('calendar-cell-2026-06-10').getByTestId('calendar-event-1')).toHaveCount(0)
    await expect(page.getByTestId('calendar-move-preview')).toHaveCount(0)
    // 끈 뒤의 click 은 일정을 열지 않는다
    await expect(page.getByTestId('calendar-event-dialog')).toHaveCount(0)
  })

  test('주 보기 — 일정을 다음 날 열 1시간 아래 칸에 놓으면 그 날짜·시각으로 저장된다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    const original = calendarEvent({ id: 1, title: '팀 회의', startsAt: '2026-06-10T01:00:00Z', endsAt: '2026-06-10T02:00:00Z' })
    const patches = await stubEvents(page, [original])
    await page.goto('/calendar')
    await page.getByTestId('calendar-view-week-btn').click()
    const block = page.getByTestId('calendar-view-week').getByTestId('calendar-event-1')
    await block.scrollIntoViewIfNeeded()
    await expect(block).toBeVisible()

    const box = (await block.boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + 10 }
    // 목(6/11) 열 가운데, 한 시간 칸(48px) 아래
    const thursday = (await page.getByTestId('calendar-day-column').nth(4).boundingBox())!
    const to = { x: thursday.x + thursday.width / 2, y: from.y + 48 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await expect(page.getByTestId('calendar-day-column').nth(4).getByTestId('calendar-move-preview')).toBeVisible()
    await page.mouse.up()

    await expect.poll(() => patches.length).toBe(1)
    const { body } = patches[0]
    expect(new Date(body.startsAt!).getTime() - new Date(original.startsAt).getTime()).toBe(DAY + HOUR)
    expect(new Date(body.endsAt!).getTime() - new Date(body.startsAt!).getTime()).toBe(HOUR)
    await expect(page.getByTestId('calendar-day-column').nth(4).getByTestId('calendar-event-1')).toBeVisible()
    await expect(page.getByTestId('calendar-event-dialog')).toHaveCount(0)
  })

  test('끌지 않고 누르기만 하면 지금처럼 일정이 열린다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    const patches = await stubEvents(page, [calendarEvent({ id: 1 })])
    await page.goto('/calendar')
    await page.getByTestId('calendar-event-1').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    expect(patches).toHaveLength(0)
  })
})
