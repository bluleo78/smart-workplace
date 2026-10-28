// 일정 참석자(#489·#547) — 화면 테스트(WP-966). 새 일정 폼의 참석자 고르기 → 저장 본문(attendeeUserIds), 편집 모드의 즉시 초대(POST /attendees),
// 상세 응답의 참석자 칩(AGENT 배지·외부 이메일·제거 버튼 유무)은 브라우저 없이 판정되므로 e2e/pages/calendar/calendar-attendees.spec.ts 에서 옮겼다.
// 조직·내 그룹을 골라 구성원을 한 번에 넣기(WP-1059) — 인원 확인 줄 → 저장 본문·초대 본문도 여기서 본다.
// 남은 E2E: RSVP 수락 → PATCH /rsvp → 버튼 상태(calendar-attendees.spec @wiring).
// 동작을 가진 일정 다이얼로그(EventDialog)만 renderScreen 으로 띄운다 — 저장 본문은 onSubmit 으로 받는다(CalendarPage 가 그대로 POST 에 싣는다).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { calendarHandlers, capture, pinNow, renderEventDialog } from '@/test/kits/calendar/testkit-b8'
import type { Attendee, CalendarEvent } from '@/types/calendar'
import type { UserGroupMemberHit } from '@/types/userGroup'

import { calendar, calendarEvent } from '../../../e2e/factories/calendar.factory'
import { personalNode, sharedNode } from '../../../e2e/factories/userGroups.factory'

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

/** 구성원 검색 — 검색어가 있으면 홍길동·AI Bot 중 요청한 종류(kind)만 준다(GET /members?search=&kind=, #833 — 서버처럼 종류로 거른다). */
const memberSearch = http.get('/api/v1/members', ({ request }) => {
  const params = new URL(request.url).searchParams
  const kind = params.get('kind') ?? 'ALL'
  const all = [
    { userId: 2, username: 'user2', name: '홍길동', email: 'hong@test.com', kind: 'HUMAN', active: true },
    { userId: 99, username: 'ai-bot', name: 'AI Bot', email: 'ai@test.com', kind: 'AGENT', active: true },
  ]
  const content = params.get('search') ? all.filter((m) => kind === 'ALL' || m.kind === kind) : []
  return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
})

/** 조직도 부서 「개발팀」(10)과 내 그룹 「주간회의」(20). */
const DEV_TEAM = sharedNode({ name: '개발팀' })
const WEEKLY = personalNode({ name: '주간회의' })

/** 구성원 찾기 응답 한 줄 — 서버는 활성 사람과 외부 연락처를 준다. */
function hit(groupId: number, targetId: number, name: string, targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER'): UserGroupMemberHit {
  return { targetType, targetId, name, email: null, title: null, organization: null, groupId, groupPath: [] }
}

/** 그룹 트리 + 구성원 찾기(하위 포함, GET /user-groups/{id}/members/search) — 개발팀엔 나(1)·홍길동(2)·김민수(3)·이서연(4)·외부 연락처, 주간회의엔 홍길동·김민수. */
const groupHandlers = [
  http.get('/api/v1/user-groups', () => HttpResponse.json({ shared: [DEV_TEAM], personal: [WEEKLY] })),
  http.get('/api/v1/user-groups/10/members/search', () =>
    HttpResponse.json([hit(10, 1, '관리자'), hit(10, 2, '홍길동'), hit(10, 3, '김민수'), hit(10, 4, '이서연'), hit(10, 700, '외부 손님', 'EXTERNAL')]),
  ),
  http.get('/api/v1/user-groups/20/members/search', () => HttpResponse.json([hit(20, 2, '홍길동'), hit(20, 3, '김민수')])),
]

/** 내가 주최한 일정(상세에 참석자 포함) — 목록 이벤트엔 참석자가 없고 다이얼로그가 상세를 다시 받는다. */
function organizerEvent(attendees: Attendee[]): { list: CalendarEvent; detail: CalendarEvent } {
  const list = calendarEvent({ id: 100, title: '참석자 테스트 일정' })
  return { list, detail: { ...list, myRole: 'ORGANIZER', myRsvpStatus: 'ACCEPTED', attendeeCount: attendees.length, attendees } }
}

/** 「＋ 참석자」로 고르기 창을 열고 「홍」을 검색해 홍길동 행을 누른다. */
async function pickHong(user: ReturnType<typeof renderEventDialog>['user']) {
  await user.click(screen.getByTestId('attendee-add-btn'))
  const popover = await screen.findByTestId('attendee-picker-search')
  // 검색 입력(aria-label 「사람·팀 검색」) — jsdom 에선 모달 다이얼로그 밖 포털이라 역할 조회 대신 이름표로 찾는다
  fireEvent.change(within(popover).getByLabelText('사람·팀 검색'), { target: { value: '홍' } })
  await user.click(await screen.findByTestId('attendee-picker-person-2', {}, { timeout: 3000 }))
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

test('새 일정: 고르기 창은 사람만 찾는다 — AI 에이전트는 후보에 없다(WP-1059)', async () => {
  const { user } = renderEventDialog(null, [memberSearch, ...calendarHandlers({ calendars: CALENDARS })])
  await pickHong(user)
  expect(screen.queryByTestId('attendee-picker-person-99')).not.toBeInTheDocument()
})

test('새 일정: 조직을 고르면 넣을 인원을 확인받고, 「N명 추가」로 이미 고른 사람·나·외부 연락처를 뺀 구성원을 넣는다(WP-1059)', async () => {
  const { user, onSubmit } = renderEventDialog(null, [memberSearch, ...groupHandlers, ...calendarHandlers({ calendars: CALENDARS })])
  await pickHong(user)
  await user.click(await screen.findByTestId('attendee-picker-department-10'))

  // 바로 넣지 않고 확인 줄에 인원과 뺀 사람을 보인다
  expect(await screen.findByTestId('attendee-group-confirm-title')).toHaveTextContent('개발팀 구성원 2명을 참석자로 추가합니다')
  expect(screen.getByTestId('attendee-group-confirm-detail')).toHaveTextContent('이미 있는 1명·나 제외')
  expect(screen.queryByTestId('attendee-selected-3')).not.toBeInTheDocument()

  // 확인 단추가 포커스를 받아 Enter 로 넣는다 — 검색창에 남으면 Enter 가 같은 그룹을 다시 고른다(키보드 확인)
  await waitFor(() => expect(screen.getByTestId('attendee-group-add')).toHaveFocus())
  await user.keyboard('{Enter}')
  expect(screen.queryByTestId('attendee-group-confirm')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(await screen.findByTestId('attendee-selected-3')).toHaveTextContent('김민수')
  expect(screen.getByTestId('attendee-selected-4')).toHaveTextContent('이서연')

  // 넣은 사람은 한 명씩 뺄 수 있다
  await user.click(screen.getByRole('button', { name: '이서연 선택 취소' }))
  fireEvent.change(screen.getByTestId('calendar-form-title'), { target: { value: '팀 회의' } })
  await user.click(screen.getByTestId('calendar-form-submit'))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0][0]).toMatchObject({ attendeeUserIds: [2, 3] })
})

test('새 일정: 조직 확인을 취소하면 아무도 넣지 않는다(WP-1059)', async () => {
  const { user } = renderEventDialog(null, [memberSearch, ...groupHandlers, ...calendarHandlers({ calendars: CALENDARS })])
  await user.click(screen.getByTestId('attendee-add-btn'))
  await user.click(await screen.findByTestId('attendee-picker-department-10'))
  await screen.findByTestId('attendee-group-add')
  await user.click(screen.getByTestId('attendee-group-cancel'))
  expect(screen.queryByTestId('attendee-group-confirm')).not.toBeInTheDocument()
  expect(screen.queryByTestId('attendee-selected-chips')).not.toBeInTheDocument()
})

test('편집 모드(주최자): 내 그룹을 고르고 확인하면 이미 참석자인 사람을 뺀 구성원을 한 요청으로 초대한다(WP-1059)', async () => {
  const { list, detail } = organizerEvent([ORGANIZER, { ...AGENT, userId: 2, kind: 'HUMAN', name: '홍길동' }])
  const invite = capture('post', '/calendar/events/100/attendees')
  const { user } = renderEventDialog(list, [
    invite.handler,
    memberSearch,
    ...groupHandlers,
    ...calendarHandlers({ calendars: CALENDARS, events: [detail] }),
  ])
  await screen.findByTestId('attendee-chips')
  await user.click(screen.getByTestId('attendee-add-btn'))
  await user.click(await screen.findByTestId('attendee-picker-personal-group-20'))
  expect(await screen.findByTestId('attendee-group-confirm-title')).toHaveTextContent('주간회의 구성원 1명을 참석자로 추가합니다')
  expect(invite.bodies).toEqual([])
  await user.click(screen.getByTestId('attendee-group-add'))
  await waitFor(() => expect(invite.bodies).toEqual([{ userIds: [3] }]))
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
