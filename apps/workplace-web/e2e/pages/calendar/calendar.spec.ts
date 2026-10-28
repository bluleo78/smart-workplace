// 캘린더 E2E — 브라우저가 필요한 판정만 남겼다(WP-966).
// - @wiring: /calendar 진입 → 일정 API → 월 보기 칩 + 보기 전환(화면당 1건)
// - @layout: 상세 전 참석자 줄 자리(높이), 주 보기 종일 칸 정렬·날짜 열 높이·겹치는 일정 나란히(WP-1138), 모바일 오늘 배지 넘침
// - @input: 주 보기 시간 구간 끌어 만들기
// - @platform: 다시 들어오면 마지막 보기(localStorage, 데스크톱·모바일 따로)
// 헤더 접근성 이름·요일·오늘 강조·일정 색·반복 회차 표시, 만들기·수정·삭제·반복 범위 선택 payload, 일정 폼 입력·검증은
// src/pages/calendar/calendarPage.test.tsx·calendarEventDialog.test.tsx(renderScreen)가 지킨다.
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import { attendee, calendarEvent } from '../../factories/calendar.factory'
import { expect, test } from '../../fixtures/auth.fixture'

/**
 * GET/POST /api/v1/calendar/events 를 메서드별로 분기 모킹.
 * store 배열을 공유해 POST 후 GET 이 최신 목록을 반환하도록 한다.
 */
async function stubCalendarEvents(page: Page, store: CalendarEvent[]) {
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const method = route.request().method()

      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(store),
        })
      }

      if (method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}') as Partial<CalendarEvent>
        const newEvent = calendarEvent({ id: 999, title: body.title ?? '새 일정', ...body })
        store.push(newEvent)
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newEvent),
        })
      }

      if (method === 'PATCH') {
        const url = new URL(route.request().url())
        const id = Number(url.pathname.split('/').pop())
        const body = JSON.parse(route.request().postData() ?? '{}') as Partial<CalendarEvent>
        const idx = store.findIndex((e) => e.id === id)
        if (idx !== -1) store[idx] = { ...store[idx], ...body }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(store[idx] ?? {}),
        })
      }

      if (method === 'DELETE') {
        const url = new URL(route.request().url())
        const id = Number(url.pathname.split('/').pop())
        const idx = store.findIndex((e) => e.id === id)
        if (idx !== -1) store.splice(idx, 1)
        return route.fulfill({ status: 204 })
      }

      return route.fallback()
    },
  )
}

test(
  '월 뷰 진입 + 일정 표시 + 뷰 전환',
  { tag: ['@wiring', '@smoke'] },
  async ({ authenticatedPage: page }) => {
    // 현재 시각을 2026-06-10 으로 고정 → 월 뷰가 2026-06 을 표시
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent()]
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 월 뷰 루트 및 일정 카드 노출 확인
    await expect(page.getByTestId('calendar-view-month')).toBeVisible()
    await expect(page.getByTestId('calendar-event-1')).toBeVisible()

    // 아젠다 뷰 전환
    await page.getByTestId('calendar-view-agenda-btn').click()
    await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
    await expect(page.getByTestId('calendar-event-1')).toBeVisible()

    // 주 뷰 전환
    await page.getByTestId('calendar-view-week-btn').click()
    await expect(page.getByTestId('calendar-view-week')).toBeVisible()

    // 일 뷰 전환
    await page.getByTestId('calendar-view-day-btn').click()
    await expect(page.getByTestId('calendar-view-day')).toBeVisible()
  },
)

// WP-801 편집 폼은 상세(주최자 여부·참석자)가 오기 전엔 참석자 줄을 판정할 수 없다 — 숨겼다가 뒤늦게 끼워 넣으면 아래 칸이 밀렸다.
// 상세가 오기 전에도 같은 높이의 자리표시를 두어, 상세가 와 참석자 줄로 바뀌어도 아래 알림 칸이 제자리인지 본다.
test('편집 폼은 상세가 오기 전에도 참석자 줄 자리를 잡아 아래 칸이 밀리지 않는다 (WP-801)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  const ev = calendarEvent({ id: 1, title: '주간 회의', myRole: 'ORGANIZER', attendees: [attendee('ORGANIZER', 1)] })
  await stubCalendarEvents(page, [ev])
  // 상세 응답은 테스트가 풀어 줄 때까지 붙잡아 둔다(나중 등록 라우트가 먼저 잡는다)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  await page.route(
    (url) => url.pathname === '/api/v1/calendar/events/1',
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await gate
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ev) })
    },
  )

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-1').first().click()
  await expect(page.getByTestId('calendar-form-attendees-loading')).toBeVisible()
  const before = await page.getByTestId('calendar-form-reminder').boundingBox()

  release()
  await expect(page.getByTestId('attendee-add-btn')).toBeVisible()
  await expect(page.getByTestId('calendar-form-attendees-loading')).toHaveCount(0)
  const after = await page.getByTestId('calendar-form-reminder').boundingBox()
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(1)
})

// 반드시 KST 로 고정한다 — UTC 호스트에서는 +9h 시프트 버그가 재현되지 않는다(종일 칸 배치).
// 다중일 종일이 걸친 날 칸마다 보이는지는 calendarPage.test.tsx 가 지키고, 여기선 칸 기하만 본다.
test.describe('주 보기 종일·시간 그리드 기하 (KST 고정)', { tag: '@layout' }, () => {
  test.use({ timezoneId: 'Asia/Seoul' })

  // WP-538: 종일 칸이 날짜 헤더 열과 같은 폭이어야 한다 — 줄바꿈 없는 긴 제목이 칸 최소 폭을 키워 칸이 어긋나면, 여러 날 일정이
  // 엉뚱한 날짜 열에 걸쳐 보였다(헤더 159px 인데 종일 칸 113/220px).
  test(
    '주 뷰 종일 행 — 긴 제목이어도 종일 칸이 날짜 헤더 열과 같은 위치·폭이다',
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
      await stubCalendarEvents(page, [
        calendarEvent({
          id: 1, allDay: true,
          title: '제주 오프사이트 워크숍 — 2027 전략 수립 및 조직 개편안 최종 검토(전 팀장 참석)',
          startsAt: '2026-06-08T00:00:00+09:00', endsAt: '2026-06-11T00:00:00+09:00',
        }),
      ])

      await page.goto('/calendar')
      await page.getByTestId('calendar-view-week-btn').click()
      await expect(page.getByTestId('calendar-event-1')).toHaveCount(3)

      const headers = page.getByTestId('calendar-day-header')
      const cells = page.getByTestId('calendar-allday-cell')
      await expect(cells).toHaveCount(7)
      for (let i = 0; i < 7; i++) {
        const h = await headers.nth(i).boundingBox()
        const c = await cells.nth(i).boundingBox()
        expect(Math.abs(c!.x - h!.x), `${i}번째 칸 x`).toBeLessThan(1)
        expect(Math.abs(c!.width - h!.width), `${i}번째 칸 폭`).toBeLessThan(1)
      }
    },
  )

  // WP-544: 날짜 열이 스크롤 영역의 보이는 높이로만 늘어나 그 아래(16시 이후)에서 세로 구분선(border-l)이 끊겼다 —
  // 날짜 열은 24시간 슬롯 전체 높이(24 × 48px)여야 한다.
  test(
    '주 뷰 시간 그리드 — 날짜 열이 24시간 전체 높이라 세로 구분선이 끝까지 이어진다',
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
      await stubCalendarEvents(page, [])

      await page.goto('/calendar')
      await page.getByTestId('calendar-view-week-btn').click()

      const columns = page.getByTestId('calendar-day-column')
      await expect(columns).toHaveCount(7)
      for (let i = 0; i < 7; i++) {
        const box = await columns.nth(i).boundingBox()
        expect(box!.height, `${i}번째 열 높이`).toBeGreaterThanOrEqual(24 * 48)
      }
    },
  )

  // WP-1138: 시간이 겹치는 일정이 모두 같은 자리·폭(left/right 2px)으로 포개져 뒤 일정이 앞 일정을 덮었다 —
  // 겹치는 일정은 열을 나눠 나란히 그려, 서로 가리지 않고 각 블록 한가운데를 누르면 그 일정이 눌린다.
  test(
    '주 뷰 시간 그리드 — 겹치는 일정은 나란히 그려져 서로 가리지 않는다 (WP-1138)',
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
      await stubCalendarEvents(page, [
        calendarEvent({ id: 5, title: '겹침A', startsAt: '2026-06-10T01:00:00+09:00', endsAt: '2026-06-10T02:00:00+09:00' }),
        calendarEvent({ id: 7, title: '겹침C', startsAt: '2026-06-10T01:15:00+09:00', endsAt: '2026-06-10T03:00:00+09:00' }),
        calendarEvent({ id: 6, title: '겹침B', startsAt: '2026-06-10T01:30:00+09:00', endsAt: '2026-06-10T02:30:00+09:00' }),
      ])

      await page.goto('/calendar')
      await page.getByTestId('calendar-view-week-btn').click()
      const blocks = [5, 7, 6].map((id) => page.getByTestId(`calendar-event-${id}`))
      for (const b of blocks) await expect(b).toBeVisible()

      const boxes = await Promise.all(blocks.map(async (b) => (await b.boundingBox())!))
      // 가로로 겹치지 않는다(왼쪽부터 A·C·B).
      expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(boxes[1].x + 0.5)
      expect(boxes[1].x + boxes[1].width).toBeLessThanOrEqual(boxes[2].x + 0.5)
      // 각 블록 한가운데의 맨 위 요소가 그 블록 자신이다 — 다른 일정에 가려지지 않아 누를 수 있다.
      for (const [i, b] of blocks.entries()) {
        const { x, y, width, height } = boxes[i]
        const hit = await page.evaluate(
          ([cx, cy]) => document.elementFromPoint(cx, cy)?.closest('button')?.getAttribute('data-testid') ?? null,
          [x + width / 2, y + height / 2],
        )
        expect(hit).toBe(await b.getAttribute('data-testid'))
      }
    },
  )
})

// WP-556: 모바일 주 보기의 좁은 날짜 열에서 오늘 배지가 고정 높이(h-7)라 두 줄로 접힌 「6.16 (화)」 위아래가 잘렸다 —
// 배지가 글자 높이만큼 늘어나 넘치지 않고, 열 폭 안에 들어와야 한다.
test('모바일 주 보기 — 오늘 날짜 배지가 좁은 열에서 잘리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-16T03:00:00Z'))
  await stubCalendarEvents(page, [])
  await page.setViewportSize({ width: 390, height: 844 })

  await page.goto('/calendar')
  // 모바일은 보기 전환이 셀렉트다.
  await page.getByTestId('calendar-view-select').selectOption('week')
  const badge = page.getByTestId('calendar-view-week').getByTestId('calendar-today-badge')
  await expect(badge).toHaveText('6.16 (화)')

  const m = await badge.evaluate((el) => {
    const cell = el.closest('[data-testid="calendar-day-header"]') as HTMLElement
    const b = el.getBoundingClientRect()
    const c = cell.getBoundingClientRect()
    return { overflowY: el.scrollHeight - el.clientHeight, overflowX: el.scrollWidth - el.clientWidth, inCell: b.left >= c.left - 0.5 && b.right <= c.right + 0.5 }
  })
  expect(m.overflowY, '배지 세로 넘침').toBeLessThanOrEqual(0)
  expect(m.overflowX, '배지 가로 넘침').toBeLessThanOrEqual(0)
  expect(m.inCell, '배지가 날짜 열 안').toBe(true)
})

// WP-949 — 주·일 보기에서 시간 구간을 끌면 그 구간을 하이라이트하고, 놓으면 시작·종료가 채워진 만들기 창이 열린다(30분 단위).
// 끌지 않고 한 칸만 누르면 지금처럼 정각 + 1시간으로 연다. 날짜를 넘기는 끌기는 시작한 날 안으로 자른다.
test.describe('시간 구간 끌어 일정 만들기 (WP-949)', { tag: '@input' }, () => {
  // 날짜 열의 y(그날 0시 기준 px)를 화면 좌표로 — 시간 그리드를 9시쯤으로 스크롤해 둔 뒤 잰다.
  async function columnPoint(page: Page, index: number, y: number) {
    const column = page.getByTestId('calendar-day-column').nth(index)
    const box = (await column.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + y }
  }
  async function openWeekAt9(page: Page) {
    await page.goto('/calendar')
    await page.getByTestId('calendar-view-week-btn').click()
    await page.getByTestId('calendar-day-column').first().evaluate((el) => {
      el.parentElement!.scrollTop = 9 * 48
    })
  }

  test('10:00~11:30 을 끌면 그 시간이 채워진 창이 열리고 그 시간으로 저장된다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await stubCalendarEvents(page, [])
    await openWeekAt9(page)

    // 수요일(6/10) 열 — 10:05 쯤에서 11:25 쯤까지 끈다.
    const from = await columnPoint(page, 3, 10 * 48 + 4)
    const to = await columnPoint(page, 3, 11 * 48 + 20)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    const selection = page.getByTestId('calendar-drag-selection')
    await expect(selection).toHaveText('10:00 – 11:30')
    await page.mouse.up()
    await expect(selection).toHaveCount(0)

    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    await expect(page.getByTestId('calendar-form-start')).toHaveValue('2026-06-10T10:00')
    await expect(page.getByTestId('calendar-form-end')).toHaveValue('2026-06-10T11:30')
    await page.getByTestId('calendar-form-title').fill('설계 리뷰')
    const post = page.waitForRequest((req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'))
    await page.getByTestId('calendar-form-submit').click()
    const body = (await post).postDataJSON() as { title: string; startsAt: string; endsAt: string; allDay: boolean }
    expect(body.title).toBe('설계 리뷰')
    expect(body.allDay).toBe(false)
    expect(new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()).toBe(90 * 60_000)
  })

  test('아래에서 위로 끌어도 되고, 다른 요일로 넘어가도 시작한 날 안의 구간이다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await stubCalendarEvents(page, [])
    await openWeekAt9(page)

    const from = await columnPoint(page, 3, 12 * 48 + 30) // 12:30~13:00 칸
    const to = await columnPoint(page, 4, 10 * 48 + 30) // 옆 요일(목) 10:30 쯤
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()
    await expect(page.getByTestId('calendar-form-start')).toHaveValue('2026-06-10T10:30')
    await expect(page.getByTestId('calendar-form-end')).toHaveValue('2026-06-10T13:00')
  })

  test('끌지 않고 한 칸만 누르면 지금처럼 정각부터 1시간으로 연다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await stubCalendarEvents(page, [])
    await openWeekAt9(page)

    const at = await columnPoint(page, 3, 14 * 48 + 30)
    await page.mouse.click(at.x, at.y)
    await expect(page.getByTestId('calendar-form-start')).toHaveValue('2026-06-10T14:00')
    await expect(page.getByTestId('calendar-form-end')).toHaveValue('2026-06-10T15:00')
  })
})

// WP-948: 캘린더를 다시 열면 마지막으로 쓴 보기(월·주·일)로 열린다. 데스크톱과 모바일은 따로 기억한다.
test('다시 들어오면 마지막으로 쓴 보기로 열린다 (WP-948)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendarEvents(page, [])

  // 처음엔 기본 보기(월)
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'true')

  // 주 보기로 바꾸고 나갔다 다시 들어오면 주 보기
  await page.getByTestId('calendar-view-week-btn').click()
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-week-btn')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()

  // 일 보기도 같다
  await page.getByTestId('calendar-view-day-btn').click()
  await expect(page.getByTestId('calendar-view-day-btn')).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-day-btn')).toHaveAttribute('aria-pressed', 'true')

  // 월 보기로 돌아가면 다시 월
  await page.getByTestId('calendar-view-month-btn').click()
  await expect(page.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'true')

  // 모바일은 따로 — 데스크톱에서 고른 보기와 상관없이 기본(목록), 모바일에서 고른 주 보기를 기억한다
  await page.getByTestId('calendar-view-week-btn').click()
  await expect(page.getByTestId('calendar-view-week-btn')).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-select')).toHaveValue('agenda')
  await page.getByTestId('calendar-view-select').selectOption('week')
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-view-select')).toHaveValue('week')
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
})
