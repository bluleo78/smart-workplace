// 캘린더 E2E — 4뷰 전환 + 일정 표시 + 새 일정 생성 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import type { CalendarEvent } from '../../src/types/calendar'
import { calendarEvent, recurringCalendarEvent } from '../factories/calendar.factory'
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
  '새 일정 생성 시 리마인더 설정이 payload 에 포함된다',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 제목 입력 + 리마인더 '10분 전' 선택
    await page.getByTestId('calendar-form-title').fill('스탠드업')
    await page.getByTestId('calendar-form-reminder').click()
    await page.getByRole('option', { name: '10분 전' }).click()

    // POST payload 캡처 — reminderMinutes 가 포함되는지 검증
    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const post = await postPromise
    expect(post.postDataJSON()).toMatchObject({ reminderMinutes: 10 })

    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
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

    // DELETE 요청 발생 횟수 추적
    let deleteCount = 0
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/v1/calendar/events')) deleteCount++
    })

    await page.goto('/calendar')

    // 일정 클릭 → EventDialog 열림 → 삭제 → confirm 다이얼로그 표시
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
    await page.getByTestId('calendar-form-delete').click()
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeVisible()

    // '취소' 클릭 → 다이얼로그 닫힘, DELETE 미발생, 일정 카드 유지
    await page.getByTestId('calendar-confirm-delete-cancel').click()
    await expect(page.getByTestId('calendar-confirm-delete-dialog')).toBeHidden()
    expect(deleteCount).toBe(0)
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

test(
  '반복 일정 생성 — recurrenceRule(FREQ=WEEKLY) 가 POST payload 에 포함된다',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 제목 입력 + 반복 빈도 '매주'(WEEKLY) 선택
    await page.getByTestId('calendar-form-title').fill('주간 회의')
    await page.getByTestId('calendar-form-recurrence-freq').click()
    await page.getByRole('option', { name: '매주' }).click()

    // POST payload 캡처 — recurrenceRule = FREQ=WEEKLY (interval=1 은 생략)
    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const post = await postPromise
    expect(post.postDataJSON()).toMatchObject({ recurrenceRule: 'FREQ=WEEKLY' })

    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  },
)

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

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const post = await postPromise
    expect(post.postDataJSON()).toMatchObject({ recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;COUNT=3' })

    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  },
)

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

    // POST 가 발생하지 않아야 함을 증명하기 위해 요청 카운트 추적
    let postCount = 0
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/v1/calendar/events')) postCount++
    })

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
    expect(postCount).toBe(0)
  },
)

test(
  '반복 종료 날짜가 시작일과 같으면 저장 허용 — RRULE 에 UNTIL 포함(이슈 #114)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    await stubCalendarEvents(page, store)

    await page.goto('/calendar')

    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    await page.getByTestId('calendar-form-title').fill('당일 종료')
    await page.getByTestId('calendar-form-start').fill('2026-06-19T09:00')
    await page.getByTestId('calendar-form-end').fill('2026-06-19T10:00')
    await page.getByTestId('calendar-form-recurrence-freq').click()
    await page.getByRole('option', { name: '매주' }).click()
    await page.getByTestId('calendar-form-recurrence-end').click()
    await page.getByRole('option', { name: '날짜까지' }).click()
    // 시작일과 동일한 날짜 → 1회차 발생하므로 허용되어야 함
    await page.getByTestId('calendar-form-recurrence-until').fill('2026-06-19')

    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const post = await postPromise
    expect(post.postDataJSON()).toMatchObject({
      recurrenceRule: 'FREQ=WEEKLY;UNTIL=20260619T235959Z',
    })

    await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
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

  test(
    '동기화 종일(UTC 자정 [6/6,6/7))은 월 뷰에서 6/6 셀에만 렌더된다',
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

      // M365 동기화 종일은 UTC 자정 half-open [6/6 00:00Z, 6/7 00:00Z) 로 저장된다.
      // instant 겹침으로 비교하면 배타적 end(6/7 00:00Z = 6/7 09:00 KST)가 6/7 셀에 걸려 더블렌더.
      const store: CalendarEvent[] = [
        calendarEvent({
          id: 1, title: '현충일', allDay: true,
          startsAt: '2026-06-06T00:00:00Z', endsAt: '2026-06-07T00:00:00Z',
        }),
      ]
      await stubCalendarEvents(page, store)

      await page.goto('/calendar')
      await expect(page.getByTestId('calendar-view-month')).toBeVisible()

      // 정확히 한 셀에만 — 더블렌더면 count 2 (회귀)
      await expect(page.getByTestId('calendar-event-1')).toHaveCount(1)
      // 6/6 셀 안에 있고 6/7 셀엔 없다
      await expect(
        page.getByTestId('calendar-cell-2026-06-06').getByTestId('calendar-event-1'),
      ).toBeVisible()
      await expect(
        page.getByTestId('calendar-cell-2026-06-07').getByTestId('calendar-event-1'),
      ).toHaveCount(0)
    },
  )

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

  test(
    '어젠다 — 동기화 종일(UTC 자정)이 의도한 날짜(6/6 토)로 한 줄 표시된다',
    async ({ authenticatedPage: page }) => {
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

      const store: CalendarEvent[] = [
        calendarEvent({
          id: 1, title: '현충일', allDay: true,
          startsAt: '2026-06-06T00:00:00Z', endsAt: '2026-06-07T00:00:00Z',
        }),
      ]
      await stubCalendarEvents(page, store)

      await page.goto('/calendar')
      await page.getByTestId('calendar-view-agenda-btn').click()
      await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()

      // 한 줄만(중복 없음) + 날짜 라벨이 6.6 (토) — instant 로 밀리지 않음
      await expect(page.getByTestId('calendar-event-1')).toHaveCount(1)
      await expect(page.getByText('6.6 (토)')).toBeVisible()
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
