// 일정 참석자 + RSVP E2E — RSVP 수락 → PATCH /rsvp → 버튼 상태 배선(@wiring). 백엔드 없이 page.route 모킹 사용. (이슈 #489)
// 참석자 고르기 → 저장 본문(attendeeUserIds)·편집 모드 즉시 초대(POST /attendees)·참석자 칩(AGENT 배지·외부 이메일·제거 버튼)은
// src/pages/calendar/calendarAttendees.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import type { Attendee, CalendarEvent } from '../../../src/types/calendar'
import type { MemberSummary } from '../../../src/types/member'
import type { UserGroupMemberHit } from '../../../src/types/userGroup'
import { calendarEvent } from '../../factories/calendar.factory'
import { sharedNode, tree } from '../../factories/userGroups.factory'
import { mockApi } from '../../fixtures/api-mock'
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

// 조직을 고르면 고르기 창 아래에 붙는 확인 줄이 창을 화면 밖으로 늘려 「N명 추가」가 화면 아래로 사라지고(1366×768),
// 모바일에선 검색창이 화면 위로 밀려났다(WP-1113) — 창 높이를 남은 높이로 묶어 후보 목록이 줄어든다. 실제 레이아웃으로 본다.
for (const viewport of [
  { name: '1366×768', width: 1366, height: 768 },
  { name: '모바일', width: 390, height: 844 },
]) {
  test(`참석자 조직 확인 줄 — ${viewport.name} 에서도 「N명 추가」와 검색창이 화면 안에 있다(WP-1113)`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubCalendar(page, [], makeDetailEvent())
    // 후보 목록이 가득 차도록(최대 높이) 사람 여러 명과 조직 하나.
    const people: MemberSummary[] = Array.from({ length: 12 }, (_, i) => ({
      userId: 10 + i, username: `p${i}@t.local`, name: `사람${i}`, email: `p${i}@t.local`, title: null,
      kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null,
    }))
    await mockApi(page, 'GET', '/api/v1/members', { content: people, page: 0, size: 20, totalElements: people.length, totalPages: 1 })
    await mockApi(page, 'GET', '/api/v1/user-groups', tree({ shared: [sharedNode({ name: '개발팀' })], personal: [] }))
    const hits: UserGroupMemberHit[] = people.slice(0, 3).map((p) => ({
      targetType: 'MEMBER', targetId: p.userId, name: p.name, email: p.email, title: null, organization: null, groupId: 10, groupPath: [],
    }))
    await mockApi(page, 'GET', '/api/v1/user-groups/10/members/search', hits)

    await page.goto('/calendar?new=true')
    await page.getByTestId('attendee-add-btn').click()
    await expect(page.getByTestId('attendee-picker-person-10')).toBeVisible()
    await page.getByTestId('attendee-picker-department-10').click()
    const add = page.getByTestId('attendee-group-add')
    await expect(add).toHaveText('3명 추가')

    // 「N명 추가」·검색창·창 전체가 화면 안에 있다.
    const [addBox, searchBox, popBox] = await Promise.all([
      boxOf(add),
      boxOf(page.getByRole('combobox', { name: '사람·팀 검색' })),
      boxOf(page.getByTestId('attendee-picker-search')),
    ])
    // 화면 아래 끝 = 모바일 하단 탭바 위(탭바가 없으면 0) — 탭바에 가린 버튼도 놓친다.
    const tabBar = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-tabbar-h')) || 0)
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(viewport.height - tabBar)
    // 확인 줄은 창 테두리 안에 있다 — 창 밖으로 삐져나오지 않는다.
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(popBox.y + popBox.height)
    expect(searchBox.y).toBeGreaterThanOrEqual(0)
    expect(popBox.y).toBeGreaterThanOrEqual(0)
    expect(popBox.y + popBox.height).toBeLessThanOrEqual(viewport.height)
    // 마우스로 누를 수 있다 — 눌러 칩이 생긴다.
    await add.click()
    await expect(page.getByTestId('attendee-section')).toContainText('사람0')
  })
}

// 조직으로 수백 명을 넣으면 칩이 모두 펼쳐져 일정 창이 수천 px 길어지고, 칩 뒤 「＋ 참석자」에 붙은 고르기 창이 화면 밖으로
// 밀려났다(WP-1189) — 칩을 앞 10개만 그리고 「외 N명 더 보기」로 접는다. 실제 레이아웃(높이·창 위치)으로 본다.
for (const viewport of [
  { name: '1440×900', width: 1440, height: 900 },
  { name: '모바일', width: 390, height: 844 },
]) {
  test(`조직으로 498명을 넣어도 ${viewport.name} 에서 참석자 줄이 짧고 고르기 창이 화면 안에 있다(WP-1189)`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await stubCalendar(page, [], makeDetailEvent())
    await mockApi(page, 'GET', '/api/v1/members', { content: [], page: 0, size: 20, totalElements: 0, totalPages: 1 })
    await mockApi(page, 'GET', '/api/v1/user-groups', tree({ shared: [sharedNode({ name: '중간부서' })], personal: [] }))
    const hits: UserGroupMemberHit[] = Array.from({ length: 498 }, (_, i) => ({
      targetType: 'MEMBER', targetId: 100 + i, name: `사람${String(i).padStart(3, '0')}`, email: null, title: null,
      organization: null, groupId: 10, groupPath: [],
    }))
    await mockApi(page, 'GET', '/api/v1/user-groups/10/members/search', hits)

    await page.goto('/calendar?new=true')
    await page.getByTestId('attendee-add-btn').click()
    await page.getByTestId('attendee-picker-department-10').click()
    await page.getByTestId('attendee-group-add').click()
    await expect(page.getByTestId('attendee-chips-toggle')).toHaveText('외 488명 더 보기')

    // 고르기 창은 열린 채 화면 안에 있다 — 이어 치는 글자가 보이지 않는 검색칸으로 들어가지 않는다.
    const pop = await boxOf(page.getByTestId('attendee-picker-search'))
    expect(pop.y).toBeGreaterThanOrEqual(0)
    expect(pop.y + pop.height).toBeLessThanOrEqual(viewport.height)
    // 참석자 줄 높이가 인원에 비례해 늘지 않는다(접기 전: 데스크톱 약 3,250px·휴대폰 약 7,500px).
    const section = await boxOf(page.getByTestId('attendee-section'))
    expect(section.height).toBeLessThan(300)
  })
}
