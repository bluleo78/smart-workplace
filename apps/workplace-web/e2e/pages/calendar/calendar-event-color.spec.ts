// 일정 다이얼로그 — 캘린더 선택 + 색 override → POST 배선 E2E(@wiring). 백엔드 없이 page.route 로 /api/v1/calendars 와 /api/v1/calendar/events 를 모킹한다.
// 기본 캘린더 선택·늦은 캘린더 로드에도 입력 보존·편집 모드 상속/override 표시·「상속」 → PATCH color null·월간 칩 색 클래스는
// src/pages/calendar/calendarExternal.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

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
  '새 일정 — 캘린더 변경 + 색 override → POST payload { calendarId, color } 검증',
  { tag: ['@wiring', '@smoke'] },
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

    // 색 — 캘린더 칸의 점을 누르면 팔레트 팝오버가 열리고, '상속' 칩이 기본으로 활성 상태여야 한다.
    await page.getByTestId('calendar-form-color').click()
    await expect(page.getByTestId('calendar-color-inherit')).toHaveAttribute('aria-pressed', 'true')

    // 색 'red' override 선택 → 팝오버가 닫히고 점이 빨강이 된다.
    await page.getByTestId('calendar-color-red').click()
    await expect(page.getByTestId('calendar-color-popover')).toHaveCount(0)
    await expect(page.getByTestId('calendar-form-color').locator('span')).toHaveClass(/bg-red-500/)

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
