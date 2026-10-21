// 캘린더 E2E — 4뷰 전환 + 일정 표시 + 새 일정 생성 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../../src/types/calendar'
import { calendarEvent, recurringCalendarEvent } from '../../factories/calendar.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

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

// #818 — 이전/다음 버튼 accessible name 부재 + 뷰 전환 버튼 선택 상태(aria-pressed) 미노출 회귀 방지.
test('헤더 이전/다음 버튼 accessible name + 뷰 전환 버튼 aria-pressed (#818)', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendarEvents(page, [])
  await page.goto('/calendar')

  // 월 뷰 — "달" 단위 라벨
  await expect(page.getByTestId('calendar-prev')).toHaveAccessibleName('이전 달')
  await expect(page.getByTestId('calendar-next')).toHaveAccessibleName('다음 달')
  await expect(page.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('calendar-view-week-btn')).toHaveAttribute('aria-pressed', 'false')

  // 일 뷰 전환 — "날" 단위 라벨 + aria-pressed 갱신
  await page.getByTestId('calendar-view-day-btn').click()
  await expect(page.getByTestId('calendar-prev')).toHaveAccessibleName('이전 날')
  await expect(page.getByTestId('calendar-next')).toHaveAccessibleName('다음 날')
  await expect(page.getByTestId('calendar-view-day-btn')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('calendar-view-month-btn')).toHaveAttribute('aria-pressed', 'false')
})

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

// 종일 체크 → 시작/종료 자정 정규화 배선(#575). 정규화 규칙(같은 날 → 익일 자정 등)과 월 뷰 배치는
// calendarEventForm.test(normalizeAllDayRange)·calendar.test(eventsOnDay)가 지키고, 여기선 체크박스 → 입력값·payload 연결만 본다.
test(
  '종일 체크 시 시작/종료 입력이 자정으로 바뀌고 allDay 로 저장된다 (#575)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await stubCalendarEvents(page, [])

    await page.goto('/calendar')
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    await page.getByTestId('calendar-form-title').fill('종일테스트일정')
    await page.getByTestId('calendar-form-allday').click()
    await expect(page.getByTestId('calendar-form-start')).toHaveValue(/T00:00$/)
    await expect(page.getByTestId('calendar-form-end')).toHaveValue(/T00:00$/)

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    expect((await postPromise).postDataJSON()).toMatchObject({ allDay: true })
  },
)

// WP-711 종일을 켰다 끄면 체크 전 시각으로 돌아온다 — 체크가 시각을 자정으로 덮어써, 풀어도 00:00~익일 00:00 의
// 24시간짜리 시간 일정으로 저장되던 문제. 날짜를 옮긴 경우 등 복원 규칙은 calendarEventForm.test(restoreTimedRange)가 지킨다.
test('종일을 켰다 끄면 원래 시각으로 돌아오고 그 시각으로 저장된다 (WP-711)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  const store: CalendarEvent[] = [calendarEvent({ id: 1, title: '주간 회의' })]
  await stubCalendarEvents(page, store)

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-1').first().click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  const start = page.getByTestId('calendar-form-start')
  const end = page.getByTestId('calendar-form-end')
  const before = { start: await start.inputValue(), end: await end.inputValue() }
  expect(before.start).not.toMatch(/T00:00$/)

  const allDay = page.getByTestId('calendar-form-allday')
  await allDay.click()
  await expect(start).toHaveValue(/T00:00$/)
  await allDay.click()
  await expect(start).toHaveValue(before.start)
  await expect(end).toHaveValue(before.end)

  const patchPromise = page.waitForRequest(
    (req) => req.method() === 'PATCH' && req.url().includes('/api/v1/calendar/events/1'),
  )
  await page.getByTestId('calendar-form-submit').click()
  const body = (await patchPromise).postDataJSON() as { allDay: boolean; startsAt: string; endsAt: string }
  expect(body.allDay).toBe(false)
  expect(new Date(body.startsAt).toISOString()).toBe(new Date('2026-06-10T01:00:00Z').toISOString())
  expect(new Date(body.endsAt).toISOString()).toBe(new Date('2026-06-10T02:00:00Z').toISOString())
})

// 리마인더/반복/참석자 → 요청 바디 변환·반복 종료일 같은 날 허용(#114)은
// calendarEventForm.test(normalizeAllDayRange·toEventRequest·eventFormSchema)가 지킨다.
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

test('주최자가 여는 편집 폼에도 회의 참가 버튼이 있고, 새 일정 폼에는 없다 (WP-710)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  const joinUrl = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0'
  const meeting = calendarEvent({ id: 1, title: '팀 회의', onlineMeeting: { provider: 'TEAMS', joinUrl } })
  // 목록 응답은 회의를 판정하지 않는다(서버) — 상세(GET /events/{id})에만 onlineMeeting 이 실린다.
  await stubCalendarEvents(page, [calendarEvent({ id: 1, title: '팀 회의' })])
  await page.route(
    (url) => url.pathname === '/api/v1/calendar/events/1',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meeting) })
        : route.fallback(),
  )

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-1').first().click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
  // 읽기 전용 상세가 아니라 편집 폼이다
  await expect(page.getByTestId('calendar-form-title')).toBeVisible()
  const join = page.getByTestId('calendar-form-join')
  await expect(join).toHaveText('Teams 회의 참가')
  await expect(join).toHaveAttribute('href', joinUrl)
  await expect(join).toHaveAttribute('target', '_blank')
  await expect(join).toHaveAttribute('rel', /noopener/)

  // 새 일정에는 회의 정보가 없어 버튼이 없다
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  await page.getByTestId('calendar-new-event').click()
  await expect(page.getByTestId('calendar-form-title')).toBeVisible()
  await expect(page.getByTestId('calendar-form-join')).toHaveCount(0)
})

test(
  '일정 삭제 — confirm 다이얼로그 확인 후 삭제',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent({ id: 1 })]
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 일정 클릭 → EventDialog 열림
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 삭제 버튼 클릭 → EventDialog 닫히고 confirm 다이얼로그 표시 (이슈 #128)
    await page.getByTestId('calendar-form-delete').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeVisible()

    // DELETE 요청 캡처 후 '삭제' 확인 버튼 클릭
    const deletePromise = page.waitForRequest(
      (req) => req.method() === 'DELETE' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-confirm-delete-confirm').click()
    await deletePromise

    // confirm 다이얼로그 닫힘 + 일정 카드 사라짐
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeHidden()
    await expect(page.getByTestId('calendar-event-1')).toHaveCount(0)
  },
)

test(
  '일정 삭제 — confirm 취소 시 일정 유지 및 DELETE 미발생 (이슈 #128)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent({ id: 1 })]
    await stubCalendarEvents(page, store)

    const deletes = trackRequests(page, 'DELETE', (url) => url.pathname.startsWith('/api/v1/calendar/events'))

    await page.goto('/calendar')

    // 일정 클릭 → EventDialog 열림 → 삭제 → confirm 다이얼로그 표시
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    await page.getByTestId('calendar-form-delete').click()
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeVisible()

    // '취소' 클릭 → 다이얼로그 닫힘, DELETE 미발생, 일정 카드 유지
    await page.getByTestId('calendar-confirm-delete-cancel').click()
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeHidden()
    expect(deletes.count()).toBe(0)
    await expect(page.getByTestId('calendar-event-1')).toBeVisible()
  },
)

test(
  '일정 삭제 confirm 버튼 — destructive 스타일 적용 (이슈 #142)',
  async ({ authenticatedPage: page }) => {
    // 파괴적 작업 버튼이 기본 파란색(primary)이 아닌 빨간색(destructive)으로 표시되어야 함
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    const store: CalendarEvent[] = [calendarEvent({ id: 1 })]
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    await page.getByTestId('calendar-form-delete').click()
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeVisible()

    // 확인 버튼에 bg-destructive 클래스가 있어야 함 — primary 스타일이면 회귀
    const confirmBtn = page.getByTestId('calendar-confirm-delete-confirm')
    await expect(confirmBtn).toHaveClass(/bg-destructive/)
  },
)

// ────────────────────────────────────────────────────────────
// 반복 일정 (이슈 #111)
// ────────────────────────────────────────────────────────────

// 마스터 id 와 6월 내 가상 회차 날짜(주 단위). 월 뷰에서 모두 보이도록 6월로 고정.
const MASTER_ID = 5
const OCC_DATES = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z', '2026-06-22T01:00:00Z']

// 빈도·간격·종료 → RRULE 조립 규칙은 recurrence.test(buildRRule)가 지킨다 — 여기선 폼 입력(빈도·간격·횟수·리마인더)이 payload 로 이어지는지 한 번.
// 리마인더 select → reminderMinutes 변환 규칙은 calendarEventForm.test(toEventRequest)가 지킨다(WP-412 에서 별도 테스트를 여기로 합침).
test(
  '반복 일정 생성 — 간격/횟수 설정이 RRULE 로 조립된다',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    await page.getByTestId('calendar-form-title').fill('격주 스프린트')
    // 빈도 매주 → 간격 2 → 종료 횟수 3
    await page.getByTestId('calendar-form-recurrence-freq').click()
    await page.getByRole('option', { name: '매주' }).click()
    await page.getByTestId('calendar-form-recurrence-interval').fill('2')
    await page.getByTestId('calendar-form-recurrence-end').click()
    await page.getByRole('option', { name: '횟수' }).click()
    await page.getByTestId('calendar-form-recurrence-count').fill('3')
    await page.getByTestId('calendar-form-reminder').click()
    await page.getByRole('option', { name: '10분 전' }).click()

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const post = await postPromise
    expect(post.postDataJSON()).toMatchObject({ recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=3', reminderMinutes: 10 })

    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  },
)

// WP-760: 간격은 서버 상한(999)까지만 — 넘기면 저장 요청을 보내지 않고 입력칸에 안내한다.
test('반복 간격이 999 를 넘으면 저장하지 않고 안내한다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  const store: CalendarEvent[] = []
  await stubCalendarEvents(page, store)
  let posted = false
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/v1/calendar/events')) posted = true
  })

  await page.goto('/calendar')
  await page.getByTestId('calendar-new-event').click()
  await page.getByTestId('calendar-form-title').fill('매일 점검')
  await page.getByTestId('calendar-form-recurrence-freq').click()
  await page.getByRole('option', { name: '매일' }).click()
  await page.getByTestId('calendar-form-recurrence-interval').fill('1000')
  await page.getByTestId('calendar-form-submit').click()

  await expect(page.getByText('간격은 999 이하여야 합니다')).toBeVisible()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
  expect(posted).toBe(false)
})

test('반복 일정 — 여러 회차가 월 뷰에 표시된다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // GET 이 마스터 id 를 공유하는 3개 회차를 반환
  const store: CalendarEvent[] = recurringCalendarEvent(MASTER_ID, OCC_DATES)
  await stubCalendarEvents(page, store)

  await page.goto('/calendar')

  await expect(page.getByTestId('calendar-view-month')).toBeVisible()
  // 각 회차는 고유 testid(calendar-event-5-<occurrenceDate>) 로 렌더 → 3건 (이슈 #174: 복합 키)
  for (const occ of OCC_DATES) {
    await expect(page.getByTestId(`calendar-event-${MASTER_ID}-${occ}`)).toBeVisible()
  }
})

test(
  '반복 회차 단일 수정 — PATCH scope=THIS + occurrenceDate(verbatim)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = recurringCalendarEvent(MASTER_ID, OCC_DATES)
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 첫 회차(가장 이른 날짜) 클릭 → EventDialog 열림 (이슈 #174: 복합 key/testid)
    await page.getByTestId(`calendar-event-${MASTER_ID}-${OCC_DATES[0]}`).click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 제목 수정 후 저장 → EventDialog 닫히고 scope 선택 다이얼로그 표시
    await page.getByTestId('calendar-form-title').fill('수정된 회차')
    await page.getByTestId('calendar-form-submit').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    await expect(page.getByTestId('calendar-recurrence-scope-dialog')).toBeVisible()

    // '이 일정만'(THIS) 클릭 → PATCH /events/{masterId}?scope=THIS&occurrenceDate=<verbatim>
    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-recurrence-scope-this').click()
    const patch = await patchPromise

    const url = new URL(patch.url())
    expect(url.pathname.endsWith(`/${MASTER_ID}`)).toBe(true)
    expect(url.searchParams.get('scope')).toBe('THIS')
    // occurrenceDate 는 회차 행 값(불투명 문자열)을 그대로 echo
    expect(url.searchParams.get('occurrenceDate')).toBe(OCC_DATES[0])
    // 수정한 제목이 PATCH body 에 실제로 담겼는지 확인 + 반복 규칙 필드 존재
    expect(patch.postDataJSON().title).toBe('수정된 회차')
    expect(patch.postDataJSON().recurrenceRule).toBeTruthy()

    await expect(page.getByTestId('calendar-recurrence-scope-dialog')).toBeHidden()
  },
)

test(
  '폼이 담을 수 없는 반복 규칙(여러 요일)은 반복 칸이 잠기고 저장해도 원래 규칙 그대로(WP-708)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    // MCP 로 만든 「매주 월·수」 일정 — 예전엔 폼이 BYDAY 를 버려 저장하면 「매주 월요일」로 바뀌었다.
    const store: CalendarEvent[] = recurringCalendarEvent(MASTER_ID, OCC_DATES, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' })
    await stubCalendarEvents(page, store)
    await page.goto('/calendar')

    await page.getByTestId(`calendar-event-${MASTER_ID}-${OCC_DATES[0]}`).click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    // 반복 드롭다운·간격·종료 칸 대신 안내 문구
    await expect(page.getByTestId('calendar-form-recurrence-locked')).toContainText('저장해도 원래 규칙이 유지돼요')
    await expect(page.getByTestId('calendar-form-recurrence-freq')).toHaveCount(0)
    await expect(page.getByTestId('calendar-form-recurrence-interval')).toHaveCount(0)

    await page.getByTestId('calendar-form-title').fill('수정된 회의')
    await page.getByTestId('calendar-form-submit').click()
    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-recurrence-scope-all').click()
    const patch = await patchPromise
    expect(patch.postDataJSON()).toMatchObject({ title: '수정된 회의', recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' })
  },
)

test(
  '잠긴 반복 규칙은 「새 규칙으로 바꾸기」로 풀어 반복 없음으로 저장할 수 있다(WP-708)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    const store: CalendarEvent[] = recurringCalendarEvent(MASTER_ID, OCC_DATES, { recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE' })
    await stubCalendarEvents(page, store)
    await page.goto('/calendar')
    await page.getByTestId(`calendar-event-${MASTER_ID}-${OCC_DATES[0]}`).click()

    // 풀면 폼이 담을 수 있는 「매주」로 채워진 드롭다운이 나온다 → 「없음」으로 바꿔 저장
    await page.getByTestId('calendar-form-recurrence-unlock').click()
    await expect(page.getByTestId('calendar-form-recurrence-locked')).toHaveCount(0)
    await expect(page.getByTestId('calendar-form-recurrence-freq')).toContainText('매주')
    await page.getByTestId('calendar-form-recurrence-freq').click()
    await page.getByRole('option', { name: '없음' }).click()
    await page.getByTestId('calendar-form-submit').click()
    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-recurrence-scope-all').click()
    expect((await patchPromise).postDataJSON().recurrenceRule ?? null).toBeNull()
  },
)

test(
  '반복 회차 단일 삭제 — DELETE scope=THIS + occurrenceDate(verbatim)',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = recurringCalendarEvent(MASTER_ID, OCC_DATES)
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 첫 회차 클릭 → EventDialog 열림 (이슈 #174: 복합 key/testid)
    await page.getByTestId(`calendar-event-${MASTER_ID}-${OCC_DATES[0]}`).click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 삭제 → EventDialog 닫히고 scope 선택 다이얼로그 표시
    await page.getByTestId('calendar-form-delete').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    await expect(page.getByTestId('calendar-recurrence-scope-dialog')).toBeVisible()

    // '이 일정만'(THIS) 클릭 → DELETE /events/{masterId}?scope=THIS&occurrenceDate=<verbatim>
    const deletePromise = page.waitForRequest(
      (req) => req.method() === 'DELETE' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-recurrence-scope-this').click()
    const del = await deletePromise

    const url = new URL(del.url())
    expect(url.pathname.endsWith(`/${MASTER_ID}`)).toBe(true)
    expect(url.searchParams.get('scope')).toBe('THIS')
    expect(url.searchParams.get('occurrenceDate')).toBe(OCC_DATES[0])

    await expect(page.getByTestId('calendar-recurrence-scope-dialog')).toBeHidden()
  },
)

test(
  '반복 종료 날짜가 시작일보다 이전이면 검증 에러 — 저장 차단(이슈 #114)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    await stubCalendarEvents(page, store)

    // POST 가 발생하지 않아야 한다
    const posts = trackRequests(page, 'POST', (url) => url.pathname.startsWith('/api/v1/calendar/events'))

    await page.goto('/calendar')

    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 시작/종료를 명시적으로 지정(시작 2026-06-19) → until(2026-06-10)이 시작보다 이전
    await page.getByTestId('calendar-form-title').fill('Orphan 방지')
    await page.getByTestId('calendar-form-start').fill('2026-06-19T09:00')
    await page.getByTestId('calendar-form-end').fill('2026-06-19T10:00')
    // 반복 매주 → 종료 날짜까지 → 시작보다 이전 날짜 입력
    await page.getByTestId('calendar-form-recurrence-freq').click()
    await page.getByRole('option', { name: '매주' }).click()
    await page.getByTestId('calendar-form-recurrence-end').click()
    await page.getByRole('option', { name: '날짜까지' }).click()
    await page.getByTestId('calendar-form-recurrence-until').fill('2026-06-10')

    // 저장 클릭 → zod 검증 실패로 onSubmit 미실행
    await page.getByTestId('calendar-form-submit').click()

    // 검증 에러 메시지가 UI 에 노출되고 다이얼로그는 닫히지 않는다
    await expect(page.getByText('반복 종료 날짜는 시작일 이후여야 합니다')).toBeVisible()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    // POST 가 전혀 발생하지 않았음(orphan 저장 차단)
    expect(posts.count()).toBe(0)
  },
)

test(
  '저장 버튼: POST 진행 중 disabled 상태 — 중복 제출 차단 (이슈 #130)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // POST 응답을 인위적으로 지연시켜 isPending=true 구간을 만든다.
    let resolvePost!: () => void
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/calendar/events'),
      async (route) => {
        const method = route.request().method()
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          })
        }
        if (method === 'POST') {
          // 외부에서 resolvePost() 를 호출할 때까지 응답을 보류
          await new Promise<void>((resolve) => {
            resolvePost = resolve
          })
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ id: 999, title: '점심 약속' }),
          })
        }
        return route.fallback()
      },
    )

    await page.goto('/calendar')
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    await page.getByTestId('calendar-form-title').fill('점심 약속')

    // POST 요청 시작 시점 감시
    const postStarted = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )

    // 첫 번째 클릭 → 요청 시작
    await page.getByTestId('calendar-form-submit').click()
    await postStarted

    // isPending=true 구간: 버튼이 disabled 이어야 함 (중복 클릭 방지)
    await expect(page.getByTestId('calendar-form-submit')).toBeDisabled()
    // 로딩 텍스트 표시 확인
    await expect(page.getByTestId('calendar-form-submit')).toContainText('저장 중')

    // 지연 해제 → 응답 완료
    resolvePost()

    // 완료 후 다이얼로그 닫힘
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  },
)

test(
  '저장 버튼을 동기적으로 연속 클릭해도 일정이 1번만 생성된다 (이슈 #584)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const posts = trackRequests(page, 'POST', (url) => url.pathname.startsWith('/api/v1/calendar/events'))
    // POST 응답에 약간의 지연을 준다 — race condition 재현
    // (isPending state 리렌더가 늦게 반영되는 실제 조건을 모사).
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/calendar/events'),
      async (route) => {
        const method = route.request().method()
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          })
        }
        if (method === 'POST') {
          await new Promise((r) => setTimeout(r, 200))
          const body = JSON.parse(route.request().postData() ?? '{}') as Partial<CalendarEvent>
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(calendarEvent({ id: 999, title: body.title ?? '더블클릭이벤트', ...body })),
          })
        }
        return route.fallback()
      },
    )

    await page.goto('/calendar')
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    await page.getByTestId('calendar-form-title').fill('더블클릭이벤트테스트')

    // 같은 이벤트 루프 틱 내에 두 번 dispatch — React state(isPending) 리렌더 전에
    // disabled 속성이 반영되기 전 상태를 재현(실제 버그의 근본 원인 조건).
    const submitButton = page.getByTestId('calendar-form-submit')
    await submitButton.evaluate((el: HTMLButtonElement) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    // 다이얼로그가 닫힐 때까지(처리 완료) 대기 후 POST 는 정확히 1번만 발생해야 한다
    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
    expect(posts.count()).toBe(1)
  },
)

// ────────────────────────────────────────────────────────────
// 반복 일정 중복 key 수정 (이슈 #174)
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// date-fns 로케일 한국어 표시 회귀 검증 (이슈 #176)
// ────────────────────────────────────────────────────────────

test(
  '목록/주/일 뷰 — 요일이 한국어로 표시된다 (이슈 #176)',
  async ({ authenticatedPage: page }) => {
    // 2026-06-08 = 월요일 → "6.8 (월)" 이어야 함. "Mon" 이면 회귀.
    await page.clock.setFixedTime(new Date('2026-06-08T03:00:00Z'))

    // 2026-06-08 시작하는 일정 1건 주입
    const store: CalendarEvent[] = [
      calendarEvent({ id: 1, startsAt: '2026-06-08T01:00:00Z', endsAt: '2026-06-08T02:00:00Z' }),
    ]
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 1) 목록(어젠다) 뷰
    await page.getByTestId('calendar-view-agenda-btn').click()
    await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
    // "Mon" 이 없고, "월" 이 보여야 한다
    await expect(page.getByText(/Mon/)).toHaveCount(0)
    await expect(page.getByText(/6\.8 \(월\)/)).toBeVisible()

    // 2) 주 뷰 날짜 헤더
    await page.getByTestId('calendar-view-week-btn').click()
    await expect(page.getByTestId('calendar-view-week')).toBeVisible()
    // 주 뷰 헤더에 영문 요일("Mon") 가 없고 한국어("월") 가 있어야 한다
    await expect(page.locator('[data-testid="calendar-view-week"] >> text=Mon')).toHaveCount(0)
    await expect(page.locator('[data-testid="calendar-view-week"] >> text=6.8 (월)')).toBeVisible()

    // 3) 일 뷰 날짜 헤더
    await page.getByTestId('calendar-view-day-btn').click()
    await expect(page.getByTestId('calendar-view-day')).toBeVisible()
    await expect(page.locator('[data-testid="calendar-view-day"] >> text=Mon')).toHaveCount(0)
    await expect(page.locator('[data-testid="calendar-view-day"] >> text=6.8 (월)')).toBeVisible()
  },
)

test(
  '반복 일정 — AgendaView 에서 각 occurrence 가 고유 testid 로 노출된다 (이슈 #174)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 마스터 id 를 공유하는 3개 회차 — AgendaView 하나의 리스트에 모두 렌더링됨
    const store: CalendarEvent[] = recurringCalendarEvent(MASTER_ID, OCC_DATES)
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    // 어젠다 뷰로 전환
    await page.getByTestId('calendar-view-agenda-btn').click()
    await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()

    // 각 회차가 고유 testid 로 렌더링됨 (수정 전: 모두 calendar-event-5 → 중복 key)
    for (const occ of OCC_DATES) {
      await expect(page.getByTestId(`calendar-event-${MASTER_ID}-${occ}`)).toBeVisible()
    }
  },
)

// ────────────────────────────────────────────────────────────
// 주/일 뷰 오늘 날짜 헤더 강조 회귀 검증 (이슈 #257)
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// 종일 일정 더블렌더 회귀 — M365 동기화 종일(UTC 자정)이 KST 에서 양일에 찍힘 (현충일 6/6·6/7)
// ────────────────────────────────────────────────────────────

// 반드시 KST 로 고정한다 — UTC 호스트에서는 +9h 시프트 버그가 재현되지 않아 회귀를 못 잡는다.
test.describe('종일 일정 타임존 렌더 (KST 고정)', () => {
  test.use({ timezoneId: 'Asia/Seoul' })
  // 월 뷰 셀 배치·어젠다 날짜 복원은 calendar.test(eventsOnDay)·calendarAgenda.test(eventDate)가 지킨다.
  // 주 뷰 종일 행만 eventsOnDay 를 따로 부르는 호출부라 그 연결을 여기서 한 번 본다.

  test(
    '주 뷰 종일 행 — 다중일 종일 [6/8,6/10)이 8·9일 두 컬럼에 걸쳐 표시된다',
    async ({ authenticatedPage: page }) => {
      // 2026-06-10(수) 고정 → 주(일~토)는 6/7~6/13. 다중일 종일 half-open [6/8,6/10) = 6/8·6/9 (6/10 제외).
      // 기존 isSameDay(startsAt) 로직은 시작일(6/8)에만 찍어 1건 → 회귀. eventsOnDay 통일 후 2건.
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

      const store: CalendarEvent[] = [
        calendarEvent({
          id: 1, title: '워크숍', allDay: true,
          startsAt: '2026-06-08T00:00:00Z', endsAt: '2026-06-10T00:00:00Z',
        }),
      ]
      await stubCalendarEvents(page, store)

      await page.goto('/calendar')
      await page.getByTestId('calendar-view-week-btn').click()
      await expect(page.getByTestId('calendar-view-week')).toBeVisible()

      // 걸친 날(6/8, 6/9) 두 컬럼에 렌더 — 배타적 end 인 6/10 에는 안 찍힘
      await expect(page.getByTestId('calendar-event-1')).toHaveCount(2)
    },
  )

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
})

test(
  '주/일 뷰 — 오늘 날짜 컬럼 헤더가 primary 배지로 강조된다 (이슈 #257)',
  async ({ authenticatedPage: page }) => {
    // 2026-06-16 = 화요일 → 주 뷰에서 "6.16 (화)" 헤더가 강조되어야 한다
    await page.clock.setFixedTime(new Date('2026-06-16T03:00:00Z'))
    await stubCalendarEvents(page, [])

    await page.goto('/calendar')

    // 1) 주간 뷰 — 오늘 날짜 헤더에만 bg-primary 뱃지가 적용된다
    await page.getByTestId('calendar-view-week-btn').click()
    await expect(page.getByTestId('calendar-view-week')).toBeVisible()

    const weekView = page.getByTestId('calendar-view-week')
    // 오늘 "6.16 (화)" 텍스트를 감싸는 span이 bg-primary 클래스를 가진다
    const todaySpanWeek = weekView.locator('span.bg-primary').filter({ hasText: '6.16 (화)' })
    await expect(todaySpanWeek).toBeVisible()

    // 다른 날은 bg-primary 뱃지 없이 텍스트만 렌더링됨
    const nonTodaySpanWeek = weekView.locator('span.bg-primary').filter({ hasText: '6.15 (월)' })
    await expect(nonTodaySpanWeek).toHaveCount(0)

    // 2) 일간 뷰 — 오늘(단일 날) 헤더도 강조된다
    await page.getByTestId('calendar-view-day-btn').click()
    await expect(page.getByTestId('calendar-view-day')).toBeVisible()

    const dayView = page.getByTestId('calendar-view-day')
    const todaySpanDay = dayView.locator('span.bg-primary').filter({ hasText: '6.16 (화)' })
    await expect(todaySpanDay).toBeVisible()
  },
)

// WP-556: 모바일 주 보기의 좁은 날짜 열에서 오늘 배지가 고정 높이(h-7)라 두 줄로 접힌 「6.16 (화)」 위아래가 잘렸다 —
// 배지가 글자 높이만큼 늘어나 넘치지 않고, 열 폭 안에 들어와야 한다.
test('모바일 주 보기 — 오늘 날짜 배지가 좁은 열에서 잘리지 않는다', async ({ authenticatedPage: page }) => {
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
