// 일정 참석자(#489·#547) — 화면 테스트(WP-966). 새 일정 폼의 참석자 고르기 → 저장 본문(attendeeUserIds), 편집 모드의 즉시 초대(POST /attendees),
// 상세 응답의 참석자 칩(AGENT 배지·외부 이메일·제거 버튼 유무)은 브라우저 없이 판정되므로 e2e/pages/calendar/calendar-attendees.spec.ts 에서 옮겼다.
// 남은 E2E: RSVP 수락 → PATCH /rsvp → 버튼 상태(calendar-attendees.spec @wiring).
// 동작을 가진 일정 다이얼로그(EventDialog)만 renderScreen 으로 띄운다 — 저장 본문은 onSubmit 으로 받는다(CalendarPage 가 그대로 POST 에 싣는다).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { Attendee, CalendarEvent } from '@/types/calendar'

import { calendar, calendarEvent } from '../../../e2e/factories/calendar.factory'
import { calendarHandlers, capture, pinNow, renderEventDialog } from './testkit-b8'

beforeEach(pinNow)
afterEach(() => vi.useRealTimers())

const CALENDARS = [calendar({ id: 1, name: '기본', isDefault: true })]

const ORGANIZER: Attendee = {
  userId: 1, username: 'user1', name: '관리자', kind: 'HUMAN', role: 'ORGANIZER',
  rsvpStatus: 'ACCEPTED', invitedByUserId: null, externalEmail: null,
}
const AGENT: Attendee = {
  userId: 99, username: 'ai-bot', name: 'AI Bot', kind: 'AGENT', role: 'ATTENDEE',
  rsvpStatus: 'ACCEPTED', invitedByUserId: 1, externalEmail: null,
}
const EXTERNAL: Attendee = {
  userId: null, username: null, name: 'Client Lee', kind: 'EXTERNAL', role: 'ATTENDEE',
  rsvpStatus: 'ACCEPTED', invitedByUserId: null, externalEmail: 'client@partner.com',
}

/** 구성원 검색 — 검색어가 있으면 홍길동·AI Bot 을 준다(GET /members?search=, #833). */
const memberSearch = http.get('/api/v1/members', ({ request }) =>
  HttpResponse.json({
    content: new URL(request.url).searchParams.get('search')
      ? [
          { userId: 2, username: 'user2', name: '홍길동', email: 'hong@test.com', kind: 'HUMAN', active: true },
          { userId: 99, username: 'ai-bot', name: 'AI Bot', email: 'ai@test.com', kind: 'AGENT', active: true },
        ]
      : [],
    page: 0, size: 20, totalElements: 2, totalPages: 1,
  }),
)

/** 내가 주최한 일정(상세에 참석자 포함) — 목록 이벤트엔 참석자가 없고 다이얼로그가 상세를 다시 받는다. */
function organizerEvent(attendees: Attendee[]): { list: CalendarEvent; detail: CalendarEvent } {
  const list = calendarEvent({ id: 100, title: '참석자 테스트 일정' })
  return { list, detail: { ...list, myRole: 'ORGANIZER', myRsvpStatus: 'ACCEPTED', attendeeCount: attendees.length, attendees } }
}

/** 「＋ 참석자」로 검색 팝오버를 열고 「홍」을 검색해 홍길동 행을 누른다. */
async function pickHong(user: ReturnType<typeof renderEventDialog>['user']) {
  await user.click(screen.getByTestId('attendee-add-btn'))
  const popover = await screen.findByTestId('member-search-popover')
  // 검색 입력(aria-label 「멤버 검색」) — jsdom 에선 모달 다이얼로그 밖 포털이라 역할 조회 대신 이름표로 찾는다
  fireEvent.change(within(popover).getByLabelText('멤버 검색'), { target: { value: '홍' } })
  await user.click(await screen.findByTestId('member-search-row-2', {}, { timeout: 3000 }))
}

test('새 일정: 참석자 줄의 「＋ 참석자」로 고른 구성원이 실명 칩으로 보이고, 저장 본문 attendeeUserIds 에 실린다', async () => {
  const { user, onSubmit } = renderEventDialog(null, [memberSearch, ...calendarHandlers({ calendars: CALENDARS })])
  expect(await screen.findByTestId('attendee-section')).toBeInTheDocument()
  await pickHong(user)
  await user.keyboard('{Escape}')
  // 생성 모드 칩은 「사용자 #2」가 아닌 실명
  expect(await screen.findByTestId('attendee-selected-2')).toHaveTextContent('홍길동')

  fireEvent.change(screen.getByTestId('calendar-form-title'), { target: { value: '참석자 테스트' } })
  await user.click(screen.getByTestId('calendar-form-submit'))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: '참석자 테스트', attendeeUserIds: [2] })
})

test('편집 모드(주최자): 상세의 참석자가 칩으로 보이고 AGENT 참석자엔 배지가 붙는다', async () => {
  const { list, detail } = organizerEvent([ORGANIZER, AGENT])
  renderEventDialog(list, calendarHandlers({ calendars: CALENDARS, events: [detail] }))
  const chips = await screen.findByTestId('attendee-chips')
  const agentChip = within(chips).getByTestId('attendee-chip-u-99')
  expect(agentChip).toHaveTextContent('AI Bot')
  expect(within(agentChip).getByTestId('agent-badge')).toBeInTheDocument()
  // 사람 주최자 칩엔 배지가 없다
  expect(within(within(chips).getByTestId('attendee-chip-u-1')).queryByTestId('agent-badge')).not.toBeInTheDocument()
})

test('편집 모드(주최자): 참석자를 고르면 저장을 기다리지 않고 POST /events/{id}/attendees 로 바로 초대한다', async () => {
  const { list, detail } = organizerEvent([ORGANIZER])
  const invite = capture('post', '/calendar/events/100/attendees')
  const { user, onSubmit } = renderEventDialog(list, [
    invite.handler,
    memberSearch,
    ...calendarHandlers({ calendars: CALENDARS, events: [detail] }),
  ])
  await screen.findByTestId('attendee-chips')
  await pickHong(user)
  await waitFor(() => expect(invite.bodies).toEqual([{ userIds: [2] }]))
  expect(onSubmit).not.toHaveBeenCalled()
})

test('외부 참석자는 이메일 칩으로 보이고 제거 버튼이 없다 (#547)', async () => {
  const { list, detail } = organizerEvent([ORGANIZER, EXTERNAL, { ...AGENT, userId: 3, kind: 'HUMAN', name: '참석자3' }])
  renderEventDialog(list, calendarHandlers({ calendars: CALENDARS, events: [detail] }))
  const externalChip = await screen.findByTestId('attendee-chip-e-client@partner.com')
  expect(externalChip).toHaveTextContent('client@partner.com')
  expect(within(externalChip).queryByRole('button')).not.toBeInTheDocument()
  // 대조: 내부 참석자는 주최자가 제거할 수 있다
  expect(screen.getByTestId('attendee-remove-3')).toBeInTheDocument()
})
