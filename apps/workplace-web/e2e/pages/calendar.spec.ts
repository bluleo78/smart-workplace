// 캘린더 E2E — 4뷰 전환 + 일정 표시 + 새 일정 생성 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../src/types/calendar'
import { calendarEvent } from '../factories/calendar.factory'
import { expect, test } from '../fixtures/auth.fixture'

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

// 테스트 실행 시점 기준으로 현재 월에 해당하는 일정 날짜를 생성해
// 월 뷰에서 항상 보이도록 보장한다.
// page.clock 을 사용해 "지금"을 고정하는 것과 달리,
// 스텁 데이터 자체를 현재 달에 맞추는 방식을 택한다.
// (page.clock API 는 Playwright 1.45+ 에서 사용 가능하며 다른 spec 에서 미사용이므로
//  여기서는 고정 날짜 2026-06-10 을 사용한다 — CI 환경에서도 항상 6월로 고정.)

test(
  '월 뷰 진입 + 일정 표시 + 뷰 전환',
  { tag: '@smoke' },
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

test(
  '새 일정 생성',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // 현재 시각을 2026-06-10 으로 고정 → 월 뷰가 2026-06 을 표시
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 초기 store 는 비어 있음 — POST 후 GET 이 반환하도록 store 공유
    const store: CalendarEvent[] = []
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 사이드바 새 일정 버튼 클릭
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 제목 입력 후 제출
    await page.getByTestId('calendar-form-title').fill('점심 약속')
    await page.getByTestId('calendar-form-submit').click()

    // 다이얼로그 닫힘 확인
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()

    // GET 재패치 후 새 이벤트 카드 노출 (id=999)
    await expect(page.getByTestId('calendar-event-999')).toBeVisible()
  },
)

test(
  '일정 편집',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent({ id: 1, title: '팀 회의' })]
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 월 뷰에서 일정 클릭 → 다이얼로그 열림
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 제목 변경 후 제출
    await page.getByTestId('calendar-form-title').fill('수정된 회의')
    await page.getByTestId('calendar-form-submit').click()

    // 다이얼로그 닫힘 후 수정된 제목이 아젠다 뷰에서 확인됨
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    await page.getByTestId('calendar-view-agenda-btn').click()
    await expect(page.getByText('수정된 회의')).toBeVisible()
  },
)

test(
  '일정 삭제',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent({ id: 1 })]
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 일정 클릭 → 다이얼로그 열림
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 삭제 버튼 클릭 → DELETE 요청 → store 에서 제거
    await page.getByTestId('calendar-form-delete').click()

    // 다이얼로그 닫힘 + 일정 카드 사라짐
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    await expect(page.getByTestId('calendar-event-1')).toHaveCount(0)
  },
)
