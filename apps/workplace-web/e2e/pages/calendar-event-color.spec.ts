// 일정 다이얼로그 — 캘린더 선택 + 색 상속/override E2E.
// 백엔드 없이 page.route 로 /api/v1/calendars 와 /api/v1/calendar/events 를 모킹한다.
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../src/types/calendar'
import { calendar, calendarEvent } from '../factories/calendar.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// GET/POST /api/v1/calendar/events 메서드별 분기 + GET /api/v1/calendars 스텁.
async function stubAll(page: Page, events: CalendarEvent[] = []) {
  await mockApi(page, 'GET', '/api/v1/calendars', [
    calendar({ id: 1, name: '기본', color: 'blue', isDefault: true }),
    calendar({ id: 2, name: '업무', color: 'red', isDefault: false }),
  ])
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) })
      }
      if (method === 'POST') {
        const body = JSON.parse(route.request().postData() ?? '{}') as Partial<CalendarEvent>
        const newEv = calendarEvent({ id: 999, ...body })
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newEv) })
      }
      return route.fallback()
    },
  )
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
}

test(
  '새 일정 — 캘린더 드롭다운이 보이고 기본값이 기본 캘린더',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await stubAll(page)
    await page.goto('/calendar')

    // 사이드바 새 일정 버튼 클릭.
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 캘린더 드롭다운이 보여야 한다.
    await expect(page.getByTestId('calendar-form-calendar')).toBeVisible()

    // 기본값 = isDefault=true 인 '기본' 캘린더.
    await expect(page.getByTestId('calendar-form-calendar')).toContainText('기본')
  },
)

test(
  '새 일정 — 캘린더 변경 + 색 override → POST payload { calendarId, color } 검증',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await stubAll(page)
    await page.goto('/calendar')

    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 제목 입력.
    await page.getByTestId('calendar-form-title').fill('업무 회의')

    // 캘린더 드롭다운에서 '업무' 선택.
    await page.getByTestId('calendar-form-calendar').click()
    await page.getByRole('option', { name: '업무' }).click()

    // 색 행 — '상속' 칩이 기본으로 활성 상태여야 한다.
    await expect(page.getByTestId('calendar-color-inherit')).toBeVisible()

    // 색 'red' override 선택.
    await page.getByTestId('calendar-color-red').click()

    // POST 요청 캡처.
    const postCapture = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const posted = await postCapture

    // payload 검증 — calendarId=2(업무), color='red'.
    const payload = posted.postDataJSON() as Record<string, unknown>
    expect(payload.calendarId).toBe(2)
    expect(payload.color).toBe('red')
  },
)

test(
  '새 일정 — 캘린더 목록 지연 로드 시 사용자 입력 보존 (cold-start 회귀)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // GET /api/v1/calendars 를 400ms 지연 후 응답 (cold-start 재현)
    await page.route(
      (url) => url.pathname === '/api/v1/calendars',
      async (route) => {
        await new Promise((r) => setTimeout(r, 400))
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            calendar({ id: 1, name: '기본', color: 'blue', isDefault: true }),
            calendar({ id: 2, name: '업무', color: 'red', isDefault: false }),
          ]),
        })
      },
    )
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/calendar/events'),
      (route) => {
        const method = route.request().method()
        if (method === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        }
        if (method === 'POST') {
          const body = JSON.parse(route.request().postData() ?? '{}') as Partial<CalendarEvent>
          const newEv = calendarEvent({ id: 999, ...body })
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newEv) })
        }
        return route.fallback()
      },
    )
    await mockApi(page, 'GET', '/api/v1/me/issues', [])

    await page.goto('/calendar')

    // 캘린더 목록 로드 전(지연 400ms)에 즉시 다이얼로그 열기
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 캘린더 목록이 아직 로드 안 된 사이에 제목·위치 입력
    await page.getByTestId('calendar-form-title').fill('회귀 테스트 일정')
    await page.getByTestId('calendar-form-location').fill('회의실 A')

    // 캘린더 목록이 로드될 때까지 대기 (기본 캘린더 드롭다운이 나타남)
    await expect(page.getByTestId('calendar-form-calendar')).toContainText('기본', { timeout: 3000 })

    // (a) 입력된 제목·위치가 그대로 남아 있어야 한다 — full reset 이 발생하면 여기서 실패
    await expect(page.getByTestId('calendar-form-title')).toHaveValue('회귀 테스트 일정')
    await expect(page.getByTestId('calendar-form-location')).toHaveValue('회의실 A')

    // (b) 저장 시 POST payload 에 defaultCalendarId(1) 가 담겨야 한다
    const postCapture = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const posted = await postCapture

    const payload = posted.postDataJSON() as Record<string, unknown>
    expect(payload.calendarId).toBe(1)
  },
)

test('편집 모드 — color=null 시 상속 칩 활성', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // color=null → effectiveColor=blue (상속)
  const eventInherit = calendarEvent({
    id: 10,
    title: '상속 일정',
    calendarId: 1,
    color: null,
    effectiveColor: 'blue',
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
  })

  await stubAll(page, [eventInherit])
  await mockApi(page, 'GET', '/api/v1/calendar/events/10', { ...eventInherit, attendees: [] })

  await page.goto('/calendar')

  // 일정 10 클릭 → 편집 다이얼로그 열림.
  await page.getByTestId('calendar-event-10').click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  // color=null 이므로 상속 칩이 활성(border-foreground) 상태.
  const inheritChip = page.getByTestId('calendar-color-inherit')
  await expect(inheritChip).toBeVisible()
  await expect(inheritChip).toHaveClass(/border-foreground/)
})

test('편집 모드 — color=red 시 red 스와치 활성', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // color='red' → red 스와치가 활성.
  const eventRed = calendarEvent({
    id: 11,
    title: '빨간 일정',
    calendarId: 1,
    color: 'red',
    effectiveColor: 'red',
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
  })

  await stubAll(page, [eventRed])
  await mockApi(page, 'GET', '/api/v1/calendar/events/11', { ...eventRed, attendees: [] })

  await page.goto('/calendar')

  await page.getByTestId('calendar-event-11').click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  // color='red' 이므로 red 스와치가 활성(border-foreground).
  const redSwatch = page.getByTestId('calendar-color-red')
  await expect(redSwatch).toBeVisible()
  await expect(redSwatch).toHaveClass(/border-foreground/)
})

test(
  '월간 뷰 — red override 이벤트 칩이 bg-red-500 클래스를 갖는다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // effectiveColor='red' → 칩이 bg-red-500 이어야 한다.
    const eventRed = calendarEvent({
      id: 20,
      title: '빨간 override',
      calendarId: 1,
      color: 'red',
      effectiveColor: 'red',
      startsAt: '2026-06-10T01:00:00Z',
      endsAt: '2026-06-10T02:00:00Z',
    })

    await stubAll(page, [eventRed])
    await page.goto('/calendar')

    // 월간 뷰 칩
    const chip = page.getByTestId('calendar-event-20')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveClass(/bg-red-500/)
  },
)

test(
  '월간 뷰 — green 캘린더 상속 이벤트 칩이 bg-emerald-500 클래스를 갖는다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // effectiveColor='green' (캘린더 color 상속) → 칩이 bg-emerald-500 이어야 한다.
    const eventGreen = calendarEvent({
      id: 21,
      title: '초록 상속',
      calendarId: 2,
      color: null,
      effectiveColor: 'green',
      startsAt: '2026-06-10T03:00:00Z',
      endsAt: '2026-06-10T04:00:00Z',
    })

    await stubAll(page, [eventGreen])
    await page.goto('/calendar')

    // 월간 뷰 칩
    const chip = page.getByTestId('calendar-event-21')
    await expect(chip).toBeVisible()
    await expect(chip).toHaveClass(/bg-emerald-500/)
  },
)
