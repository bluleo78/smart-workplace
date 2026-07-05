// 쓰기 가능한 외부(M365) 캘린더로 일정 생성 E2E.
// 백엔드 없이 page.route 로 /api/v1/calendars + /api/v1/calendar/events 를 모킹한다. (이슈 #502)
import type { Page } from '@playwright/test'

import type { Calendar } from '../../../src/types/calendar'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 이슈 #493 교훈: 호스트 TZ 에 따라 날짜 경계가 달라지므로 반드시 핀.
test.use({ timezoneId: 'Asia/Seoul' })

/**
 * 캘린더 목록 + 이벤트 기본 스텁.
 * POST 는 별도로 page.route 로 가로챈다.
 */
async function stubCalendars(page: Page, calendars: Calendar[]) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/me/issues', [])

  // GET 이벤트 목록 스텁 (빈 목록 — 새 일정 생성 시나리오)
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        })
      }
      return route.fallback()
    },
  )
}

test.describe('외부 쓰기 캘린더 일정 작성', () => {
  // 테스트용 캘린더 3종: 로컬 / 외부 쓰기 가능 / 외부 읽기전용(공휴일)
  const LOCAL_CAL = calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false })
  const EXTERNAL_WRITE_CAL = calendar({ id: 2, name: '업무(M365)', color: 'red', isDefault: false, isReadOnly: false })
  const EXTERNAL_READONLY_CAL = calendar({ id: 3, name: '대한민국 공휴일', color: 'green', isDefault: false, isReadOnly: true })

  test(
    '쓰기 가능 외부 캘린더가 새 일정 다이얼로그 Select 에 노출된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

      await stubCalendars(page, [LOCAL_CAL, EXTERNAL_WRITE_CAL, EXTERNAL_READONLY_CAL])
      await page.goto('/calendar')

      // 새 일정 생성 다이얼로그 열기
      await page.getByTestId('calendar-new-event').click()
      await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

      // 캘린더 선택 드롭다운 열기
      await page.getByTestId('calendar-form-calendar').click()

      // 쓰기 가능 외부 캘린더(id=2)는 선택지에 있어야 한다
      await expect(page.getByRole('option', { name: '업무(M365)' })).toBeVisible()

      // 읽기전용 외부 캘린더(공휴일, id=3)는 선택지에 없어야 한다
      await expect(page.getByRole('option', { name: '대한민국 공휴일' })).toHaveCount(0)
    },
  )

  test(
    '쓰기 가능 외부 캘린더로 단일 일정 생성 → POST calendarId 검증',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

      await stubCalendars(page, [LOCAL_CAL, EXTERNAL_WRITE_CAL, EXTERNAL_READONLY_CAL])
      await page.goto('/calendar')

      // 새 일정 생성 다이얼로그 열기
      await page.getByTestId('calendar-new-event').click()
      await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

      // 쓰기 가능 외부 캘린더(업무 M365) 선택
      await page.getByTestId('calendar-form-calendar').click()
      await expect(page.getByRole('option', { name: '업무(M365)' })).toBeVisible()
      await page.getByRole('option', { name: '업무(M365)' }).click()

      // 제목 입력
      await page.getByTestId('calendar-form-title').fill('역동기화 회의')

      // POST 요청 캡처 준비
      const postPromise = page.waitForRequest(
        (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
      )

      // POST 응답 스텁 (201 Created)
      await page.route(
        (url) => url.pathname === '/api/v1/calendar/events',
        async (route) => {
          if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON()
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify(
                calendarEvent({ id: 99, ...body, calendarName: '업무(M365)', effectiveColor: 'red' }),
              ),
            })
          }
          return route.fallback()
        },
      )

      await page.getByTestId('calendar-form-submit').click()

      // POST payload 검증: calendarId=2(외부 쓰기 캘린더), recurrenceRule=null(단일 일정)
      const post = await postPromise
      const payload = post.postDataJSON()
      expect(payload.calendarId).toBe(2)
      expect(payload.recurrenceRule ?? null).toBeNull()

      // 다이얼로그 닫힘 확인
      await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    },
  )
})
