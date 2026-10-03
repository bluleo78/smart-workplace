// 외부 동기화 캘린더(isReadOnly) 사이드바 표시 + 이벤트 다이얼로그 읽기전용 E2E.
// 백엔드 없이 page.route 로 /api/v1/calendars 를 모킹한다. (이슈 #501)
import type { Page } from '@playwright/test'

import type { Calendar, CalendarEvent } from '../../../src/types/calendar'
import { attendee, calendar, calendarEvent } from '../../factories/calendar.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

// 타임존 고정 — 이슈 #493 교훈: 호스트 TZ 에 따라 날짜 경계가 달라지므로 반드시 핀.
test.use({ timezoneId: 'Asia/Seoul' })

/** 캘린더 목록 + 이벤트 기본 스텁 */
async function stubCalendars(page: Page, calendars: Calendar[]) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [calendarEvent()])
  await mockApi(page, 'GET', '/api/v1/me/issues', [])
}

/**
 * 이벤트 목록 + 단일 이벤트 상세(GET /events/{id}) + 캘린더 목록 스텁.
 * 이벤트 클릭 → 다이얼로그 열기 시나리오에 사용.
 */
async function stubForDialog(page: Page, calendars: Calendar[], events: CalendarEvent[]) {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
  await mockApi(page, 'GET', '/api/v1/me/issues', [])

  // /api/v1/calendar/events 경로 패밀리 — 목록 + 단일 상세 분기 처리
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      const method = route.request().method()
      const pathname = new URL(route.request().url()).pathname

      // GET /events/{id} — 단일 상세
      if (method === 'GET' && pathname.match(/\/calendar\/events\/\d+$/)) {
        const id = Number(pathname.split('/').pop())
        const detail = events.find((e) => e.id === id) ?? events[0]
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detail),
        })
      }

      // GET /events — 목록
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(events),
        })
      }

      return route.fallback()
    },
  )
}

test(
  '외부 캘린더(isReadOnly:true)에 읽기전용 배지가 표시되고 편집 버튼이 없다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 외부(M365) 캘린더 id=10, 로컬 캘린더 id=1
    await stubCalendars(page, [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({
        id: 10,
        name: 'M365 캘린더',
        color: 'indigo',
        isDefault: false,
        isReadOnly: true,
        accountEmail: 'dh.yang@iacloud.kr',
        provider: 'M365_GRAPH',
      }),
    ])

    await page.goto('/calendar')

    // 두 캘린더 모두 사이드바에 렌더된다.
    await expect(page.getByTestId('calendar-list-item-1')).toBeVisible()
    await expect(page.getByTestId('calendar-list-item-10')).toBeVisible()

    // 외부 캘린더(id=10): 읽기전용 배지가 보여야 한다.
    const externalRow = page.getByTestId('calendar-list-item-10')
    await expect(externalRow.getByTestId('calendar-readonly-badge')).toBeVisible()
    await expect(externalRow.getByTestId('calendar-readonly-badge')).toContainText('읽기 전용')

    // 외부 캘린더(id=10): 읽기전용 = 케밥 메뉴 트리거가 없어야 한다.
    await expect(page.getByTestId('calendar-menu-10')).toHaveCount(0)

    // 로컬 캘린더(id=1): 케밥 메뉴 트리거가 있어야 한다 (숨겨진 상태라도 DOM 에 존재).
    await expect(page.getByTestId('calendar-menu-1')).toHaveCount(1)

    // 로컬 캘린더(id=1): 읽기전용 배지가 없어야 한다.
    const localRow = page.getByTestId('calendar-list-item-1')
    await expect(localRow.getByTestId('calendar-readonly-badge')).toHaveCount(0)
  },
)

test('외부 캘린더의 가시성 토글(체크박스)은 읽기전용이어도 동작한다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  await stubCalendars(page, [
    calendar({
      id: 10,
      name: 'M365 캘린더',
      color: 'indigo',
      isDefault: false,
      isReadOnly: true,
      accountEmail: 'dh.yang@iacloud.kr',
      provider: 'M365_GRAPH',
    }),
  ])

  await page.goto('/calendar')

  // 체크박스가 렌더된다.
  await expect(page.getByTestId('calendar-toggle-10')).toBeVisible()

  // 체크박스를 클릭해도 오류 없이 토글된다 (읽기전용 = 내용 편집 불가, 표시 토글은 가능).
  await page.getByTestId('calendar-toggle-10').click()
  // 재클릭으로 원상복구 — 오류 없이 완료되면 PASS.
  await page.getByTestId('calendar-toggle-10').click()
})

// ────────────────────────────────────────────────────────────
// 이벤트 다이얼로그 읽기전용 검증 (이슈 #501 Task 9)
// ────────────────────────────────────────────────────────────

test(
  '새 일정 다이얼로그 캘린더 선택에 읽기전용 컨테이너가 노출되지 않는다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 로컬 캘린더 id=1, 외부(읽기전용) 캘린더 id=10
    await stubCalendars(page, [
      calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      calendar({
        id: 10,
        name: 'M365 캘린더',
        color: 'indigo',
        isDefault: false,
        isReadOnly: true,
        accountEmail: 'dh.yang@iacloud.kr',
        provider: 'M365_GRAPH',
      }),
    ])

    await page.goto('/calendar')

    // 새 일정 생성 버튼 클릭 → 다이얼로그 열기
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 캘린더 선택을 열어 옵션 확인
    await page.getByTestId('calendar-form-calendar').click()

    // 로컬 캘린더(id=1)는 옵션에 있어야 한다
    await expect(page.getByRole('option', { name: '기본' })).toBeVisible()

    // 읽기전용 외부 캘린더(id=10)는 옵션에 없어야 한다
    await expect(page.getByRole('option', { name: 'M365 캘린더' })).toHaveCount(0)
  },
)

test(
  '외부 캘린더(isReadOnly) 이벤트 클릭 시 다이얼로그가 읽기전용으로 열린다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 외부 캘린더(id=10)에 속하는 이벤트
    const readonlyEvent = calendarEvent({
      id: 42,
      title: 'M365 회의',
      calendarId: 10,
      calendarName: 'M365 캘린더',
      startsAt: '2026-06-10T01:00:00Z',
      endsAt: '2026-06-10T02:00:00Z',
    })

    await stubForDialog(
      page,
      [
        calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
        calendar({
          id: 10,
          name: 'M365 캘린더',
          color: 'indigo',
          isDefault: false,
          isReadOnly: true,
          accountEmail: 'dh.yang@iacloud.kr',
          provider: 'M365_GRAPH',
        }),
      ],
      [readonlyEvent],
    )

    await page.goto('/calendar')

    // 이벤트 칩 클릭 → 다이얼로그 열기
    await page.getByTestId('calendar-event-42').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 동기화 라벨이 표시되어야 한다
    await expect(page.getByTestId('event-synced-label')).toBeVisible()
    await expect(page.getByTestId('event-synced-label')).toContainText('M365에서 동기화됨')

    // 제목 입력이 비활성화되어야 한다
    await expect(page.getByTestId('calendar-form-title')).toBeDisabled()

    // 장소 입력도 비활성화되어야 한다 (이슈 #501 Task 9)
    await expect(page.getByTestId('calendar-form-location')).toBeDisabled()

    // 저장(수정) 버튼이 없어야 한다
    await expect(page.getByTestId('calendar-form-submit')).toHaveCount(0)

    // 삭제 버튼도 없어야 한다
    await expect(page.getByTestId('calendar-form-delete')).toHaveCount(0)
  },
)

test(
  '로컬 캘린더 이벤트는 다이얼로그가 편집 가능 상태로 열린다 (회귀)',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 로컬 캘린더(id=1)에 속하는 이벤트
    const localEvent = calendarEvent({
      id: 1,
      title: '팀 회의',
      calendarId: 1,
      calendarName: '기본',
      startsAt: '2026-06-10T01:00:00Z',
      endsAt: '2026-06-10T02:00:00Z',
    })

    await stubForDialog(
      page,
      [
        calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false }),
      ],
      [localEvent],
    )

    await page.goto('/calendar')

    // 이벤트 칩 클릭 → 다이얼로그 열기
    await page.getByTestId('calendar-event-1').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 동기화 라벨이 없어야 한다
    await expect(page.getByTestId('event-synced-label')).toHaveCount(0)

    // 제목 입력이 활성화되어야 한다 (편집 가능)
    await expect(page.getByTestId('calendar-form-title')).toBeEnabled()

    // 저장(수정) 버튼이 있어야 한다
    await expect(page.getByTestId('calendar-form-submit')).toBeVisible()
  },
)

// ── WP-200: 주최자만 수정 ──────────────────────────────────────
// 로그인 사용자 id=1(auth.factory). 쓰기 가능한 내 M365 캘린더 id=10.
const writableM365 = calendar({
  id: 10,
  name: 'Calendar',
  color: 'indigo',
  isDefault: false,
  isReadOnly: false,
  accountEmail: 'dh.yang@iacloud.kr',
  provider: 'M365_GRAPH',
})
const localDefault = calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false })

test('다른 사람이 주최한 미팅의 내 동기화 사본은 주최자만 수정 가능으로 열린다', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // 내 쓰기 가능 M365 캘린더에 있지만 주최자는 사용자2, 나는 ATTENDEE(syncAttendees 결과 모양)
  const invitedCopy = calendarEvent({
    id: 50,
    title: '분기 리뷰',
    calendarId: 10,
    calendarName: 'Calendar',
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
    external: true,
    myRole: 'ATTENDEE',
    myRsvpStatus: 'ACCEPTED',
    attendees: [attendee('ORGANIZER', 2), attendee('ATTENDEE', 1)],
  })
  await stubForDialog(page, [localDefault, writableM365], [invitedCopy])

  // 수정·삭제 요청이 나가면 안 된다 — 나가면 기록해 실패시킨다.
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/calendar/events/50') && ['PATCH', 'DELETE'].includes(r.method())) {
      writes.push(r.method())
    }
  })

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-50').first().click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  // 이유 안내는 "주최자만" 라벨(동기화 라벨 대신)
  await expect(page.getByTestId('event-organizer-only-label')).toHaveText('주최자만 수정할 수 있어요')
  await expect(page.getByTestId('event-synced-label')).toHaveCount(0)
  // 입력 비활성 + 저장·삭제 없음
  await expect(page.getByTestId('calendar-form-title')).toBeDisabled()
  await expect(page.getByTestId('calendar-form-submit')).toHaveCount(0)
  await expect(page.getByTestId('calendar-form-delete')).toHaveCount(0)
  // 참석자 추가도 불가(눌러도 저장되지 않던 버튼 숨김)
  await expect(page.getByTestId('attendee-add-btn')).toHaveCount(0)
  expect(writes).toEqual([])
})

test('내 캘린더에 없는 초대 일정은 상세 로드 전부터 수정 불가이고 RSVP 만 가능하다', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // 사용자2의 캘린더(id=99, 내 목록에 없음)에 있는 일정 — 나는 참석자
  const othersEvent = calendarEvent({
    id: 60,
    title: '사용자2 주최 회의',
    calendarId: 99,
    calendarName: '사용자2 캘린더',
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
    myRole: 'ATTENDEE',
    myRsvpStatus: 'NEEDS_ACTION',
    attendees: [attendee('ORGANIZER', 2), attendee('ATTENDEE', 1, { rsvpStatus: 'NEEDS_ACTION' })],
  })
  await stubForDialog(page, [localDefault], [othersEvent])

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-60').first().click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  await expect(page.getByTestId('event-organizer-only-label')).toBeVisible()
  await expect(page.getByTestId('calendar-form-submit')).toHaveCount(0)
  await expect(page.getByTestId('calendar-form-delete')).toHaveCount(0)
  // 참석 응답은 계속 가능
  await expect(page.getByTestId('rsvp-controls')).toBeVisible()
})

test('내가 주최한 동기화 일정은 쓰기 가능 캘린더에서 그대로 수정할 수 있다 (회귀)', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  const myMeeting = calendarEvent({
    id: 70,
    title: '내가 연 회의',
    calendarId: 10,
    calendarName: 'Calendar',
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
    external: true,
    myRole: 'ORGANIZER',
    myRsvpStatus: 'ACCEPTED',
    attendees: [attendee('ORGANIZER', 1), attendee('ATTENDEE', 2)],
  })
  await stubForDialog(page, [localDefault, writableM365], [myMeeting])

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-70').first().click()
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  await expect(page.getByTestId('event-organizer-only-label')).toHaveCount(0)
  await expect(page.getByTestId('calendar-form-title')).toBeEnabled()
  await expect(page.getByTestId('calendar-form-submit')).toBeVisible()
  await expect(page.getByTestId('attendee-add-btn')).toBeVisible()
})
