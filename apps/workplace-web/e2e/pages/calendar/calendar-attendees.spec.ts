// 일정 참석자 + RSVP E2E — RSVP 수락 → PATCH /rsvp → 버튼 상태 배선(@wiring). 백엔드 없이 page.route 모킹 사용. (이슈 #489)
// 참석자 고르기 → 저장 본문(attendeeUserIds)·편집 모드 즉시 초대(POST /attendees)·참석자 칩(AGENT 배지·외부 이메일·제거 버튼)은
// src/pages/calendar/calendarAttendees.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import type { Attendee, CalendarEvent } from '../../../src/types/calendar'
import { calendarEvent } from '../../factories/calendar.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf } from '../../fixtures/layout'

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

// ────────────────────────────────────────────────────────────
// 테스트
// ────────────────────────────────────────────────────────────

test(
  'RSVP 수락 클릭 시 PATCH /rsvp 호출 + 상태 반영',
  { tag: ['@wiring', '@smoke'] },
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
    // 내 참석자 행이 ATTENDEE 면 서버의 myRole 도 ATTENDEE — 주최자가 아니니 읽기 전용 상세 보기로 열린다(WP-708)
    const detail = makeDetailEvent({
      attendees: [ORGANIZER_ATTENDEE, myAttendee, AGENT_ATTENDEE],
      myRsvpStatus: 'NEEDS_ACTION',
      myRole: 'ATTENDEE',
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
    // WP-637: 고른 상태를 색만이 아니라 aria-pressed 로도 알린다 — 응답 전(NEEDS_ACTION)엔 셋 다 눌리지 않음.
    const rsvpGroup = page.getByRole('group', { name: '참석 여부' })
    for (const name of ['수락', '미정', '거절']) {
      await expect(rsvpGroup.getByRole('button', { name, pressed: false })).toBeVisible()
    }

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
    // 스크린리더도 「수락」이 눌린 상태로 읽는다(나머지는 눌리지 않음).
    await expect(acceptBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('rsvp-btn-tentative')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('rsvp-btn-declined')).toHaveAttribute('aria-pressed', 'false')
  },
)

// 주최자·외부(external) 일정의 RSVP 미노출 판정은 calendarEventForm.test(shouldShowRsvp)가 지킨다.

// cn 이 제목의 break-words 를 지워 긴 제목이 창 밖으로 넘쳤다(WP-1073, src/lib/utils.ts) — 실제 레이아웃으로 본다.
test('초대받은 일정 — 띄어쓰기 없는 긴 제목도 창 안에서 줄바꿈되고 닫기(✕)를 덮지 않는다(WP-1073)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  const longTitle = '아주긴일정제목'.repeat(12)
  const store: CalendarEvent[] = [calendarEvent({ id: 100, title: longTitle })]
  const detail = makeDetailEvent({ title: longTitle, myRole: 'ATTENDEE', myRsvpStatus: 'NEEDS_ACTION' })
  await stubCalendar(page, store, detail)

  await page.goto('/calendar')
  await page.getByTestId('calendar-event-100').first().click()
  const dialog = page.getByTestId('calendar-event-dialog')
  const title = dialog.getByTestId('event-detail-title')
  await expect(title).toHaveText(longTitle)

  // 제목 글자가 제 칸을 넘지 않고(줄바꿈됨), 칸의 오른쪽 끝은 닫기(✕) 왼쪽에서 멈춘다
  const overflow = await title.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const [titleBox, closeBox] = await Promise.all([boxOf(title), boxOf(dialog.getByRole('button', { name: '닫기' }))])
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x)
})
