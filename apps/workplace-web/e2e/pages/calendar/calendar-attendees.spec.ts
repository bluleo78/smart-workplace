// 일정 참석자 + RSVP E2E — 참석자 추가·칩 표시·RSVP 수락 흐름 검증.
// 백엔드 없이 page.route 모킹 사용. (이슈 #489)
import type { Page } from '@playwright/test'

import type { Attendee, CalendarEvent } from '../../../src/types/calendar'
import { calendarEvent } from '../../factories/calendar.factory'
import { expect, test } from '../../fixtures/auth.fixture'

// ────────────────────────────────────────────────────────────
// 테스트 데이터
// ────────────────────────────────────────────────────────────

const ATTENDEE_USER: Attendee = {
  userId: 2,
  username: 'user2',
  name: '홍길동',
  kind: 'HUMAN',
  role: 'ATTENDEE',
  rsvpStatus: 'NEEDS_ACTION',
  invitedByUserId: 1,
  externalEmail: null,
}

const AGENT_ATTENDEE: Attendee = {
  userId: 99,
  username: 'ai-bot',
  name: 'AI Bot',
  kind: 'AGENT',
  role: 'ATTENDEE',
  rsvpStatus: 'ACCEPTED',
  invitedByUserId: 1,
  externalEmail: null,
}

const ORGANIZER_ATTENDEE: Attendee = {
  userId: 1,
  username: 'user1',
  name: '관리자',
  kind: 'HUMAN',
  role: 'ORGANIZER',
  rsvpStatus: 'ACCEPTED',
  invitedByUserId: null,
  externalEmail: null,
}

/** 단일 이벤트 + 참석자 스텁(GET /events/{id}) */
function makeDetailEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return calendarEvent({
    id: 100,
    title: '참석자 테스트 일정',
    attendeeCount: 3,
    myRsvpStatus: 'NEEDS_ACTION',
    // 기본적으로 현재 사용자가 ORGANIZER — 참석자 편집 게이팅 통과 (#547)
    myRole: 'ORGANIZER',
    attendees: [ORGANIZER_ATTENDEE, ATTENDEE_USER, AGENT_ATTENDEE],
    ...over,
  })
}

// ────────────────────────────────────────────────────────────
// 라우트 모킹 헬퍼 — attendees 서브경로 분기 포함
// ────────────────────────────────────────────────────────────

async function stubCalendar(page: Page, store: CalendarEvent[], detailEvent: CalendarEvent) {
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    async (route) => {
      const method = route.request().method()
      const pathname = new URL(route.request().url()).pathname

      // POST /events/{id}/attendees — 참석자 초대 (204)
      if (method === 'POST' && pathname.match(/\/events\/\d+\/attendees$/)) {
        return route.fulfill({ status: 204 })
      }

      // DELETE /events/{id}/attendees/{userId} — 참석자 제거 (204)
      if (method === 'DELETE' && pathname.match(/\/events\/\d+\/attendees\/\d+$/)) {
        return route.fulfill({ status: 204 })
      }

      // PATCH /events/{id}/rsvp — RSVP 응답 (204), detailEvent.myRsvpStatus 갱신
      if (method === 'PATCH' && pathname.match(/\/events\/\d+\/rsvp$/)) {
        const body = JSON.parse(route.request().postData() ?? '{}') as { status?: string }
        if (body.status) {
          // 스토어에서 해당 이벤트 갱신
          const idx = store.findIndex((e) => String(e.id) === pathname.split('/')[4])
          if (idx !== -1) {
            store[idx] = { ...store[idx], myRsvpStatus: body.status as CalendarEvent['myRsvpStatus'] }
          }
          detailEvent.myRsvpStatus = body.status as CalendarEvent['myRsvpStatus']
        }
        return route.fulfill({ status: 204 })
      }

      // GET /events/{id} — 단일 이벤트 상세 (attendees 포함)
      if (method === 'GET' && pathname.match(/\/events\/\d+$/)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detailEvent),
        })
      }

      // POST /events — 일정 생성
      if (method === 'POST' && pathname === '/api/v1/calendar/events') {
        const body = JSON.parse(route.request().postData() ?? '{}') as Partial<CalendarEvent>
        const newEvent = calendarEvent({ id: 999, title: body.title ?? '새 일정', ...body })
        store.push(newEvent)
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newEvent),
        })
      }

      // GET /events — 목록 반환
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(store),
        })
      }

      // 그 외 PATCH/DELETE (일정 수정/삭제)
      if (method === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(detailEvent),
        })
      }

      if (method === 'DELETE') {
        return route.fulfill({ status: 204 })
      }

      return route.fallback()
    },
  )
}

/** 유저 검색 모킹 — /api/v1/users?search= (GET /users, /users/me 제외) */
async function stubUserSearch(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/users' && url.searchParams.has('search'),
    (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [
            {
              id: 2,
              username: 'user2',
              name: '홍길동',
              email: 'hong@test.com',
              kind: 'HUMAN',
              roles: [],
            },
            {
              id: 99,
              username: 'ai-bot',
              name: 'AI Bot',
              email: 'ai@test.com',
              kind: 'AGENT',
              roles: [],
            },
          ],
          page: 0,
          size: 20,
          totalElements: 2,
          totalPages: 1,
        }),
      })
    },
  )
}

// ────────────────────────────────────────────────────────────
// 테스트
// ────────────────────────────────────────────────────────────

test(
  '일정 생성 시 참석자 추가 버튼이 노출된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    const detail = makeDetailEvent()
    await stubCalendar(page, store, detail)
    await stubUserSearch(page)

    await page.goto('/calendar')

    // 새 일정 버튼 클릭
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 참석자 섹션 + 추가 버튼 노출 확인
    await expect(page.getByTestId('attendee-section')).toBeVisible()
    await expect(page.getByTestId('attendee-add-btn')).toBeVisible()
  },
)

test(
  '일정 생성 시 attendeeUserIds 가 POST payload 에 포함된다',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = []
    const detail = makeDetailEvent()
    await stubCalendar(page, store, detail)
    await stubUserSearch(page)

    await page.goto('/calendar')
    await page.getByTestId('calendar-new-event').click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 참석자 추가 팝오버 열기
    await page.getByTestId('attendee-add-btn').click()
    await expect(page.getByTestId('member-search-popover')).toBeVisible()

    // 검색어 입력 후 결과 클릭
    await page.getByRole('combobox', { name: '멤버 검색' }).fill('홍')
    // 검색 결과 대기 후 사용자 선택
    await expect(page.getByTestId('member-search-row-2')).toBeVisible({ timeout: 3000 })
    await page.getByTestId('member-search-row-2').click()

    // 팝오버 닫기
    await page.keyboard.press('Escape')

    // 생성 모드 칩에 실제 이름이 표시되는지 확인 (사용자 #2 가 아닌 홍길동)
    await expect(page.getByTestId('attendee-selected-2')).toContainText('홍길동')

    // 제목 입력 + 저장
    await page.getByTestId('calendar-form-title').fill('참석자 테스트')
    const postPromise = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().includes('/api/v1/calendar/events'),
    )
    await page.getByTestId('calendar-form-submit').click()
    const post = await postPromise

    // attendeeUserIds 가 payload 에 포함되었는지 확인
    const payload = post.postDataJSON() as { attendeeUserIds?: number[] }
    expect(Array.isArray(payload.attendeeUserIds)).toBe(true)
    expect(payload.attendeeUserIds).toContain(2)
  },
)

test(
  '일정 상세에서 참석자 목록(칩) + AGENT 뱃지가 표시된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent({ id: 100, title: '참석자 테스트 일정' })]
    const detail = makeDetailEvent()
    await stubCalendar(page, store, detail)

    await page.goto('/calendar')

    // 일정 클릭 → 다이얼로그(상세)
    await page.getByTestId('calendar-event-100').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 참석자 칩 섹션 표시 확인
    await expect(page.getByTestId('attendee-chips')).toBeVisible()

    // AGENT 참석자에 뱃지 표시 확인 (chipKey = u-{userId})
    const agentChip = page.getByTestId('attendee-chip-u-99')
    await expect(agentChip).toBeVisible()
    await expect(agentChip.getByTestId('agent-badge')).toBeVisible()
  },
)

test(
  'RSVP 수락 클릭 시 PATCH /rsvp 호출 + 상태 반영',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 현재 사용자(id=1)는 이 이벤트에서 ATTENDEE(not organizer)
    const myAttendee: Attendee = {
      userId: 1,
      username: 'user1',
      name: '나',
      kind: 'HUMAN',
      role: 'ATTENDEE',
      rsvpStatus: 'NEEDS_ACTION',
      invitedByUserId: null,
      externalEmail: null,
    }
    const store: CalendarEvent[] = [calendarEvent({ id: 100, title: 'RSVP 테스트' })]
    const detail = makeDetailEvent({
      attendees: [ORGANIZER_ATTENDEE, myAttendee, AGENT_ATTENDEE],
      myRsvpStatus: 'NEEDS_ACTION',
    })
    // 주최자는 user id 10 (현재 사용자와 다름) 으로 설정
    detail.attendees = [
      { ...ORGANIZER_ATTENDEE, userId: 10 },
      myAttendee,
      AGENT_ATTENDEE,
    ]
    await stubCalendar(page, store, detail)

    await page.goto('/calendar')
    await page.getByTestId('calendar-event-100').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // RSVP 컨트롤이 표시되는지 확인
    await expect(page.getByTestId('rsvp-controls')).toBeVisible()

    // 수락 버튼 클릭 → PATCH /rsvp 호출
    const patchPromise = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' && req.url().includes('/rsvp'),
    )
    await page.getByTestId('rsvp-btn-accepted').click()
    const patch = await patchPromise

    // payload 에 status: 'ACCEPTED' 포함
    expect(patch.postDataJSON()).toMatchObject({ status: 'ACCEPTED' })

    // RSVP 상태 반영 — 수락 버튼이 default(bg-primary) variant 로 변경되어야 함
    const acceptBtn = page.getByTestId('rsvp-btn-accepted')
    await expect(acceptBtn).toHaveClass(/bg-primary/, { timeout: 3000 })
  },
)

test(
  '편집 모드에서 참석자 추가 시 POST /attendees 가 즉시 호출된다',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const store: CalendarEvent[] = [calendarEvent({ id: 100, title: '참석자 편집 테스트' })]
    // 초기 상태: 주최자만 있음
    const detail = makeDetailEvent({ attendees: [ORGANIZER_ATTENDEE] })
    await stubCalendar(page, store, detail)
    await stubUserSearch(page)

    await page.goto('/calendar')
    await page.getByTestId('calendar-event-100').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 참석자 추가 팝오버 열기
    await page.getByTestId('attendee-add-btn').click()
    await expect(page.getByTestId('member-search-popover')).toBeVisible()

    // 검색 후 사용자 선택
    await page.getByRole('combobox', { name: '멤버 검색' }).fill('홍')
    await expect(page.getByTestId('member-search-row-2')).toBeVisible({ timeout: 3000 })

    // POST /events/{id}/attendees 호출 확인
    const postPromise = page.waitForRequest(
      (req) =>
        req.method() === 'POST' && req.url().includes('/events/100/attendees'),
    )
    await page.getByTestId('member-search-row-2').click()
    const post = await postPromise

    // userIds 배열에 선택한 userId 포함
    expect(post.postDataJSON()).toMatchObject({ userIds: [2] })
  },
)

test(
  '주최자에게는 RSVP 컨트롤이 노출되지 않는다',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 현재 사용자(id=1) 가 ORGANIZER
    const store: CalendarEvent[] = [calendarEvent({ id: 100, title: '주최자 테스트' })]
    const detail = makeDetailEvent({
      attendees: [
        { ...ORGANIZER_ATTENDEE, userId: 1 }, // 현재 사용자가 주최자
        ATTENDEE_USER,
      ],
      myRsvpStatus: 'ACCEPTED',
    })
    await stubCalendar(page, store, detail)

    await page.goto('/calendar')
    await page.getByTestId('calendar-event-100').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 주최자이므로 RSVP 컨트롤 없음
    await expect(page.getByTestId('rsvp-controls')).toHaveCount(0)
  },
)

test(
  '외부 참석자 이메일이 칩으로 표시된다 (#547)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    const EXTERNAL_ATTENDEE: Attendee = {
      userId: null,
      username: null,
      name: 'Client Lee',
      kind: 'EXTERNAL',
      role: 'ATTENDEE',
      rsvpStatus: 'ACCEPTED',
      invitedByUserId: null,
      externalEmail: 'client@partner.com',
    }

    const store: CalendarEvent[] = [calendarEvent({ id: 100, title: '외부 참석자 일정' })]
    const detail = makeDetailEvent({
      attendees: [ORGANIZER_ATTENDEE, EXTERNAL_ATTENDEE],
    })
    await stubCalendar(page, store, detail)

    await page.goto('/calendar')
    await page.getByTestId('calendar-event-100').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 외부 참석자 칩에 이메일이 표시되어야 함
    const externalChip = page.getByTestId('attendee-chip-e-client@partner.com')
    await expect(externalChip).toBeVisible()
    await expect(externalChip).toContainText('client@partner.com')

    // 외부 참석자 칩에는 제거 버튼이 없어야 함
    await expect(externalChip.locator('button')).toHaveCount(0)
  },
)

test(
  '외부(external) 일정에서는 RSVP 컨트롤이 노출되지 않는다 (#547)',
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 현재 사용자(id=1)는 ATTENDEE(not organizer), 외부 일정
    const myAttendee: Attendee = {
      userId: 1,
      username: 'user1',
      name: '나',
      kind: 'HUMAN',
      role: 'ATTENDEE',
      rsvpStatus: 'NEEDS_ACTION',
      invitedByUserId: null,
      externalEmail: null,
    }

    const store: CalendarEvent[] = [calendarEvent({ id: 100, title: '외부 일정' })]
    const detail = makeDetailEvent({
      attendees: [{ ...ORGANIZER_ATTENDEE, userId: 10 }, myAttendee],
      myRsvpStatus: 'NEEDS_ACTION',
      // external=true: M365 동기화 일정 — RSVP 컨트롤 숨김
      external: true,
    })
    await stubCalendar(page, store, detail)

    await page.goto('/calendar')
    await page.getByTestId('calendar-event-100').first().click()
    await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

    // 외부 일정이므로 RSVP 컨트롤 없음
    await expect(page.getByTestId('rsvp-controls')).toHaveCount(0)
  },
)
