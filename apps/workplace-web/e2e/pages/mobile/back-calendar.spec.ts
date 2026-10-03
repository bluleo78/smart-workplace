// 모바일 뒤로가기 히스토리 — 캘린더 일정 상세(?eventId)(WP-208).
// 일정 클릭은 push, 시스템 뒤로가기는 다이얼로그만 닫는다. 반복 회차는 회차 날짜를 스냅숏으로 지켜 범위 선택이 동작한다.
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import { calendar, calendarEvent, recurringCalendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/mobile.fixture'

// 실데이터 폭 검증용 긴 제목.
const LONG_TITLE = '분기 경영 실적 리뷰 및 2027년 상반기 신규 사업 투자 우선순위 결정 회의(임원 전원 참석)'

async function stubCalendar(page: Page, events: CalendarEvent[]) {
  await page.clock.setFixedTime(new Date('2026-06-10T10:00:00'))
  await mockApi(page, 'GET', '/api/v1/calendars', [calendar()])
  await page.route((u) => u.pathname.startsWith('/api/v1/calendar/events'), (r) => {
    const req = r.request()
    const m = /\/api\/v1\/calendar\/events\/(\d+)$/.exec(new URL(req.url()).pathname)
    if (req.method() === 'GET' && m) {
      const ev = events.find((e) => e.id === Number(m[1]))
      return ev ? r.fulfill({ json: ev }) : r.fulfill({ status: 404, json: { message: '없음' } })
    }
    if (req.method() === 'GET') return r.fulfill({ json: events })
    if (req.method() === 'PATCH') return r.fulfill({ json: events[0] })
    return r.fallback()
  })
}

async function toAgenda(page: Page) {
  await page.getByTestId('calendar-view-select').selectOption('agenda')
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
}

test('일정 클릭 → goBack 은 다이얼로그만 닫고 캘린더에 남는다 — 취소도 같은 결과', async ({ authenticatedPage: page }) => {
  await stubCalendar(page, [calendarEvent({ id: 42, title: LONG_TITLE, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' })])
  await page.goto('/calendar')
  await toAgenda(page)
  await page.getByTestId('calendar-event-42').tap()
  const dialog = page.getByTestId('calendar-event-dialog')
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/calendar\?eventId=42$/)

  await page.goBack()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(dialog).toBeHidden()
  // 같은 라우트라 리마운트가 없어 보기(agenda)가 유지된다.
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()

  await page.getByTestId('calendar-event-42').tap()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '취소' }).tap()
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(dialog).toBeHidden()
})

test('딥링크(?eventId) → ESC 는 eventId 만 지우고 캘린더에 남는다', async ({ authenticatedPage: page }) => {
  await stubCalendar(page, [calendarEvent({ id: 42, title: LONG_TITLE })])
  await page.goto('/calendar?eventId=42')
  const dialog = page.getByTestId('calendar-event-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('calendar-form-title')).toHaveValue(LONG_TITLE)
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(dialog).toBeHidden()
})

test('반복 회차: 다이얼로그가 닫힌 뒤에도 회차 날짜가 남아 범위 선택 → 회차 PATCH', async ({ authenticatedPage: page }) => {
  const occ = recurringCalendarEvent(5, ['2026-06-15T01:00:00Z', '2026-06-22T01:00:00Z'], { title: '주간 스탠드업' })
  await stubCalendar(page, occ)
  await page.goto('/calendar')
  await toAgenda(page)
  await page.getByTestId('calendar-event-5-2026-06-15T01:00:00Z').tap()
  await expect(page).toHaveURL(/\/calendar\?eventId=5$/)
  await page.getByTestId('calendar-form-title').fill('주간 스탠드업(변경)')
  await page.getByTestId('calendar-form-submit').tap()
  const scope = page.getByTestId('calendar-recurrence-scope-dialog')
  await expect(scope).toBeVisible()
  await expect(page).toHaveURL(/\/calendar$/)
  const patch = page.waitForRequest((req) => req.method() === 'PATCH' && req.url().includes('/api/v1/calendar/events/5'))
  await page.getByTestId('calendar-recurrence-scope-this').tap()
  expect(decodeURIComponent((await patch).url())).toContain('2026-06-15')
})

test('저장 응답 전에 뒤로 갔으면 늦게 온 저장 완료 닫기가 캘린더를 떠나지 않는다', async ({ authenticatedPage: page }) => {
  const ev = calendarEvent({ id: 42, title: LONG_TITLE, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' })
  await stubCalendar(page, [ev])
  // PATCH 응답을 붙잡아 두는 라우트(나중에 등록한 라우트가 먼저 매칭된다).
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  await page.route((u) => u.pathname === '/api/v1/calendar/events/42', async (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback()
    await held
    return r.fulfill({ json: ev })
  })
  // 앱 안 기록을 하나 만든다(앱 목록 → 캘린더 push) — 그래야 낡은 닫기의 -1 이 앱 목록으로 빠지는지 드러난다.
  await page.goto('/apps')
  await page.getByTestId('apps-app-calendar').tap()
  await expect(page).toHaveURL(/\/calendar$/)
  await toAgenda(page)
  await page.getByTestId('calendar-event-42').tap()
  await page.getByTestId('calendar-form-title').fill('제목 변경')
  await page.getByTestId('calendar-form-submit').tap()
  await page.goBack()
  await expect(page).toHaveURL(/\/calendar$/)
  const patched = page.waitForResponse((res) => res.request().method() === 'PATCH')
  release()
  // 늦게 온 onSuccess → closeDialog() — 캡처한 위치 key 가 지금과 달라 무동작이어야 한다.
  await patched
  await expect(page).toHaveURL(/\/calendar$/)
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
})
