// 외부(M365) 캘린더·캘린더 선택·색(#501·#502·#547·WP-708·WP-710·WP-736) — 화면 테스트(WP-966).
// 사이드바의 읽기 전용 표시·계정 묶음·표시 토글, 새 일정의 캘린더 선택(읽기 전용 제외·기본값·늦은 로드)·색 상속/override 저장 본문,
// 읽기 전용 일정의 상세 보기(동기화 라벨·Teams 참가·참석자 접기·회차 날짜), 월간 칩 색 클래스는 브라우저 없이 판정되므로
// e2e/pages/calendar/calendar-external-readonly.spec.ts·calendar-event-external-write.spec.ts(삭제)·calendar-event-color.spec.ts 에서 옮겼다.
// 남은 E2E: 새 일정 캘린더 변경 + 색 override → POST 배선(calendar-event-color.spec @wiring),
// Teams 초대 상세 보기에서 설명은 잘리지 않고 본문 하나만 스크롤(calendar-external-readonly.spec @layout).
// 사이드바·월간 보기·일정 다이얼로그가 한 화면에서 이어지므로 CalendarPage 를 renderScreen 으로 띄운다(EventDialog 만 띄워도 불러오는 시간이 비슷하다).
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { Attendee } from '@/types/calendar'

import { calendar, calendarEvent, recurringCalendarEvent } from '../../../e2e/factories/calendar.factory'
import { calendarHandlers, capture, pinNow, renderCalendarPage } from './testkit-b8'

beforeEach(pinNow)
afterEach(() => vi.useRealTimers())

const LOCAL = calendar({ id: 1, name: '기본', color: 'blue', isDefault: true, isReadOnly: false })
const WORK = calendar({ id: 2, name: '업무', color: 'red', isDefault: false })
const M365_READONLY = calendar({
  id: 10, name: 'M365 캘린더', color: 'indigo', isDefault: false, isReadOnly: true,
  accountEmail: 'dh.yang@iacloud.kr', provider: 'M365_GRAPH',
})
const M365_WRITABLE = calendar({ id: 3, name: '업무(M365)', color: 'red', isDefault: false, isReadOnly: false })

/** 캘린더 선택(Radix Select)을 열고 보이는 옵션 이름들을 돌려준다. */
async function openCalendarSelect(user: ReturnType<typeof renderCalendarPage>['user']) {
  await user.click(await screen.findByTestId('calendar-form-calendar'))
  const options = await screen.findAllByRole('option')
  return options.map((o) => o.textContent)
}

describe('사이드바 — 외부 캘린더', () => {
  test('연동 캘린더는 계정 묶음 안에 읽기 전용 배지와 함께 보이고 케밥 메뉴가 없다(로컬은 반대)', async () => {
    renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, M365_READONLY] }))
    const acct = await screen.findByTestId('calendar-account-section-dh.yang@iacloud.kr')
    expect(acct).toHaveTextContent('dh.yang@iacloud.kr')
    expect(acct).toHaveTextContent('M365')
    expect(within(acct).getByTestId('calendar-list-item-10')).toBeInTheDocument()
    expect(within(acct).queryByTestId('calendar-list-item-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-list-item-1')).toBeInTheDocument()

    expect(within(screen.getByTestId('calendar-list-item-10')).getByTestId('calendar-readonly-badge')).toHaveTextContent('읽기 전용')
    expect(screen.queryByTestId('calendar-menu-10')).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-menu-1')).toBeInTheDocument()
    expect(within(screen.getByTestId('calendar-list-item-1')).queryByTestId('calendar-readonly-badge')).not.toBeInTheDocument()
  })

  test('읽기 전용 캘린더도 표시 토글은 동작한다 — 끄면 그 캘린더 일정이 달력에서 빠지고 켜면 돌아온다', async () => {
    const ev = calendarEvent({ id: 42, title: 'M365 회의', calendarId: 10, calendarName: 'M365 캘린더' })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [M365_READONLY], events: [ev] }))
    expect(await screen.findByTestId('calendar-event-42')).toBeInTheDocument()
    const toggle = screen.getByTestId('calendar-toggle-10')
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByTestId('calendar-event-42')).not.toBeInTheDocument())
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(await screen.findByTestId('calendar-event-42')).toBeInTheDocument()
  })
})

describe('새 일정 — 캘린더 선택·색', () => {
  test('캘린더 선택의 기본값은 기본 캘린더이고, 읽기 전용 외부 캘린더는 고를 수 없다', async () => {
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, M365_READONLY, M365_WRITABLE] }))
    await user.click(await screen.findByTestId('calendar-new-event'))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('기본'))
    const names = await openCalendarSelect(user)
    expect(names).toContain('기본')
    expect(names).toContain('업무(M365)')
    expect(names).not.toContain('M365 캘린더')
  })

  test('쓰기 가능한 외부 캘린더로 만든 단일 일정은 POST 에 그 calendarId 와 반복 없음(null)이 실리고 다이얼로그가 닫힌다 (#502)', async () => {
    const post = capture('post', '/calendar/events', () =>
      HttpResponse.json(calendarEvent({ id: 99, title: '역동기화 회의', calendarId: 3 }), { status: 201 }),
    )
    const { user } = renderCalendarPage('/calendar', [post.handler, ...calendarHandlers({ calendars: [LOCAL, M365_WRITABLE, M365_READONLY] })])
    await user.click(await screen.findByTestId('calendar-new-event'))
    await openCalendarSelect(user)
    await user.click(screen.getByRole('option', { name: '업무(M365)' }))
    await user.type(screen.getByTestId('calendar-form-title'), '역동기화 회의')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(post.bodies).toHaveLength(1))
    const body = post.bodies[0] as { calendarId: number; recurrenceRule?: string | null }
    expect(body.calendarId).toBe(3)
    expect(body.recurrenceRule ?? null).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument())
  })

  test('캘린더 목록이 늦게 와도 먼저 쓴 제목·장소를 지우지 않고 기본 캘린더만 채운다 (cold-start 회귀)', async () => {
    const post = capture('post', '/calendar/events', () => HttpResponse.json(calendarEvent({ id: 999 }), { status: 201 }))
    const { user } = renderCalendarPage('/calendar', [
      post.handler,
      // 캘린더 목록을 400ms 늦게 — 다이얼로그를 연 뒤 입력하는 사이에 도착한다
      http.get('/api/v1/calendars', async () => {
        await delay(400)
        return HttpResponse.json([LOCAL, WORK])
      }),
      ...calendarHandlers({ calendars: [LOCAL, WORK] }),
    ])
    await user.click(await screen.findByTestId('calendar-new-event'))
    await user.type(screen.getByTestId('calendar-form-title'), '회귀 테스트 일정')
    await user.type(screen.getByTestId('calendar-form-location'), '회의실 A')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('기본'), { timeout: 3000 })
    // full reset 이 일어나면 여기서 실패한다
    expect(screen.getByTestId('calendar-form-title')).toHaveValue('회귀 테스트 일정')
    expect(screen.getByTestId('calendar-form-location')).toHaveValue('회의실 A')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(post.bodies).toHaveLength(1))
    expect(post.bodies[0]).toMatchObject({ calendarId: 1, title: '회귀 테스트 일정', location: '회의실 A' })
  })
})

describe('편집 — 색 상속/override', () => {
  const base = { calendarId: 1, startsAt: '2026-06-10T01:00:00Z', endsAt: '2026-06-10T02:00:00Z', myRole: 'ORGANIZER' as const }

  test('color=null 이면 점은 캘린더 색이고 팝오버의 「상속」이 눌려 있다', async () => {
    const ev = calendarEvent({ id: 10, title: '상속 일정', color: null, effectiveColor: 'blue', ...base })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, WORK], events: [{ ...ev, attendees: [] }] }))
    await user.click(await screen.findByTestId('calendar-event-10'))
    const dot = await screen.findByTestId('calendar-form-color')
    await waitFor(() => expect(dot.querySelector('span')).toHaveClass('bg-blue-500'))
    await user.click(dot)
    expect(await screen.findByTestId('calendar-color-inherit')).toHaveAttribute('aria-pressed', 'true')
  })

  test('color=red 이면 팝오버의 red 스와치가 눌려 있다', async () => {
    const ev = calendarEvent({ id: 11, title: '빨간 일정', color: 'red', effectiveColor: 'red', ...base })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, WORK], events: [{ ...ev, attendees: [] }] }))
    await user.click(await screen.findByTestId('calendar-event-11'))
    await user.click(await screen.findByTestId('calendar-form-color'))
    expect(await screen.findByTestId('calendar-color-red')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('calendar-color-inherit')).toHaveAttribute('aria-pressed', 'false')
  })

  test('팝오버에서 「상속」을 고르면 점이 캘린더 색으로 돌아가고 PATCH 본문의 color 가 null 이다', async () => {
    const ev = calendarEvent({ id: 12, title: '빨간 일정', color: 'red', effectiveColor: 'red', ...base })
    const patch = capture('patch', '/calendar/events/12', () => HttpResponse.json(ev))
    const { user } = renderCalendarPage('/calendar', [patch.handler, ...calendarHandlers({ calendars: [LOCAL, WORK], events: [{ ...ev, attendees: [] }] })])
    await user.click(await screen.findByTestId('calendar-event-12'))
    expect(await screen.findByTestId('calendar-form-title')).toHaveValue('빨간 일정')
    await user.click(screen.getByTestId('calendar-form-color'))
    await user.click(await screen.findByTestId('calendar-color-inherit'))
    expect(screen.getByTestId('calendar-form-color').querySelector('span')).toHaveClass('bg-blue-500')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(patch.bodies).toHaveLength(1))
    expect(patch.bodies[0]).toMatchObject({ color: null, calendarId: 1 })
  })

  test('월간 칩은 effectiveColor 의 진한 칩 색 — red override 는 bg-red-600, green 상속은 bg-emerald-700 (WP-736)', async () => {
    renderCalendarPage(
      '/calendar',
      calendarHandlers({
        calendars: [LOCAL, WORK],
        events: [
          calendarEvent({ id: 20, title: '빨간 override', calendarId: 1, color: 'red', effectiveColor: 'red' }),
          calendarEvent({ id: 21, title: '초록 상속', calendarId: 2, color: null, effectiveColor: 'green', startsAt: '2026-06-10T03:00:00Z', endsAt: '2026-06-10T04:00:00Z' }),
        ],
      }),
    )
    expect(await screen.findByTestId('calendar-event-20')).toHaveClass('bg-red-600')
    expect(screen.getByTestId('calendar-event-21')).toHaveClass('bg-emerald-700')
  })
})

describe('읽기 전용 일정 — 상세 보기(WP-708·710)', () => {
  test('읽기 전용 외부 캘린더 일정은 입력칸·저장·삭제 없이 상세 보기와 「M365에서 동기화됨」으로 열린다', async () => {
    const ev = calendarEvent({ id: 42, title: 'M365 회의', calendarId: 10, calendarName: 'M365 캘린더' })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, M365_READONLY], events: [ev] }))
    await user.click(await screen.findByTestId('calendar-event-42'))
    expect(await screen.findByTestId('event-synced-label')).toHaveTextContent('M365에서 동기화됨')
    expect(screen.getByTestId('event-detail-view')).toBeInTheDocument()
    expect(screen.getByTestId('event-detail-title')).toHaveTextContent('M365 회의')
    expect(screen.getByTestId('event-detail-calendar')).toHaveTextContent('M365 캘린더')
    for (const id of ['calendar-form-title', 'calendar-form-location', 'calendar-form-submit', 'calendar-form-delete']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
  })

  test('로컬 캘린더 일정은 동기화 라벨 없이 편집 폼으로 열린다 (회귀)', async () => {
    const ev = calendarEvent({ id: 1, title: '팀 회의', calendarId: 1, calendarName: '기본' })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL], events: [ev] }))
    await user.click(await screen.findByTestId('calendar-event-1'))
    expect(await screen.findByTestId('calendar-form-title')).toBeEnabled()
    expect(screen.getByTestId('calendar-form-submit')).toBeInTheDocument()
    expect(screen.queryByTestId('event-synced-label')).not.toBeInTheDocument()
  })

  test('M365 Teams 초대: 시간·장소, 참석자 요약·접기, 참가 링크, 접힌 Teams 안내문을 보이고 응답 줄·입력칸이 없다', async () => {
    const teamsUrl = 'https://teams.microsoft.com/meet/46286105292202?p=Xk2'
    // 실제 초대 본문처럼 Teams 안내문은 밑줄 구분선 사이에 들어 있다(WP-710 — 접힘 대상)
    const sep = '_'.repeat(80)
    const longBody = `${'회의 안건 메모\n'.repeat(30)}\n${sep}\nMicrosoft Teams 모임\n참가: ${teamsUrl}\n모임 ID: 462 861 052 922 02\n${sep}`
    const person = (userId: number, name: string): Attendee => ({
      userId, username: `u${userId}`, name, kind: 'HUMAN', role: 'ATTENDEE',
      rsvpStatus: 'ACCEPTED', invitedByUserId: null, externalEmail: null,
    })
    const ev = calendarEvent({
      id: 43, title: 'DCP-46 과제 논의', calendarId: 10, calendarName: 'M365 캘린더', location: 'SynergiA',
      description: longBody, onlineMeeting: { provider: 'TEAMS', joinUrl: teamsUrl }, external: true,
      myRole: 'ATTENDEE', myRsvpStatus: 'NEEDS_ACTION',
      attendees: [
        // 외부 주최자는 이메일로, 내 행(id 1)은 주최자 바로 다음으로 정렬된다.
        { ...person(0, 'Jayden'), userId: null, kind: 'EXTERNAL', role: 'ORGANIZER', externalEmail: 'jayden@partner.kr' },
        person(2, '참석자2'), person(3, '참석자3'), person(4, '참석자4'), person(5, '참석자5'),
        { ...person(1, '나'), rsvpStatus: 'NEEDS_ACTION' },
        person(6, '참석자6'),
      ],
    })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, { ...M365_READONLY, accountEmail: null }], events: [ev] }))
    await user.click(await screen.findByTestId('calendar-event-43'))
    const view = await screen.findByTestId('event-detail-view')

    // 시간 한 줄·장소, 값 없는 알림·반복 행은 숨김
    await waitFor(() => expect(within(view).getByTestId('event-detail-time')).toHaveTextContent('6월 10일 (수) · 오전 10:00 – 11:00'))
    expect(within(view).getByTestId('event-detail-location')).toHaveTextContent('SynergiA')
    expect(within(view).queryByTestId('event-detail-reminder')).not.toBeInTheDocument()
    expect(within(view).queryByTestId('event-detail-recurrence')).not.toBeInTheDocument()

    // 참석자 — 요약, 주최자(외부는 이메일)·나 순서, 5명 뒤로 접기
    const attendeesRow = within(view).getByTestId('event-detail-attendees')
    expect(attendeesRow).toHaveTextContent('참석자 7명 · 수락 6, 대기 1')
    let rows = within(attendeesRow).getAllByTestId('event-detail-attendee')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('jayden@partner.kr')
    expect(rows[0]).toHaveTextContent('주최자')
    expect(rows[1]).toHaveTextContent('나(나)')
    const toggle = within(attendeesRow).getByTestId('event-detail-attendees-toggle')
    expect(toggle).toHaveTextContent('외 2명 더 보기')
    await user.click(toggle)
    rows = within(attendeesRow).getAllByTestId('event-detail-attendee')
    expect(rows).toHaveLength(7)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // 회의 참가 버튼 — 새 탭으로 여는 링크
    const join = within(view).getByTestId('event-detail-join')
    expect(join).toHaveTextContent('Teams 회의 참가')
    expect(join).toHaveAttribute('href', teamsUrl)
    expect(join).toHaveAttribute('target', '_blank')
    expect(join.getAttribute('rel')).toMatch(/noopener/)

    // Teams 안내문은 접혀 있고 본문(안건 메모)만 보인다. 펼치면 안내문 원문과 새 탭 링크가 나온다
    expect(within(view).getByTestId('event-detail-description')).toHaveTextContent('회의 안건 메모')
    expect(within(view).queryByTestId('event-detail-meeting-info')).not.toBeInTheDocument()
    const infoToggle = within(view).getByTestId('event-detail-meeting-info-toggle')
    expect(infoToggle).toHaveTextContent('Teams 회의 안내')
    expect(infoToggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(infoToggle)
    expect(infoToggle).toHaveAttribute('aria-expanded', 'true')
    const info = within(view).getByTestId('event-detail-meeting-info')
    expect(info).toHaveTextContent('모임 ID: 462 861 052 922 02')
    const link = within(info).getByRole('link', { name: teamsUrl })
    expect(link).toHaveAttribute('href', teamsUrl)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toMatch(/noopener/)

    // M365 일정의 응답은 Outlook 에서 — 응답 줄·편집 입력칸이 없다
    expect(screen.queryByTestId('event-detail-rsvp')).not.toBeInTheDocument()
    expect(screen.getByTestId('calendar-event-dialog').querySelectorAll('input, textarea')).toHaveLength(0)
  })

  test('Teams 안내문이 있어도 서버가 회의를 찾지 못했으면(onlineMeeting 없음) 접지 않고 링크를 그대로 보인다 (WP-710)', async () => {
    const teamsUrl = 'https://teams.microsoft.com/meet/46286105292202?p=Xk2'
    const sep = '_'.repeat(80)
    const ev = calendarEvent({
      id: 44, title: '회의 판정 없는 일정', calendarId: 10, calendarName: 'M365 캘린더',
      description: `안건 메모\n${sep}\nMicrosoft Teams 모임\n참가: ${teamsUrl}\n${sep}`,
      onlineMeeting: null, external: true, myRole: 'ATTENDEE', attendees: [],
    })
    const { user } = renderCalendarPage('/calendar', calendarHandlers({ calendars: [LOCAL, M365_READONLY], events: [ev] }))
    await user.click(await screen.findByTestId('calendar-event-44'))
    const view = await screen.findByTestId('event-detail-view')
    expect(within(view).queryByTestId('event-detail-join')).not.toBeInTheDocument()
    expect(within(view).queryByTestId('event-detail-meeting-info-toggle')).not.toBeInTheDocument()
    expect(within(within(view).getByTestId('event-detail-description')).getByRole('link', { name: teamsUrl })).toHaveAttribute('href', teamsUrl)
  })

  test('반복 일정 회차를 열면 상세(시리즈 마스터)가 와도 누른 회차의 날짜를 보인다 (WP-708)', async () => {
    // 다른 사람 캘린더(99)의 매주 회의에 초대받았다 — 상세 GET 은 첫 회차(마스터) 시각을 돌려준다.
    const occ = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z', '2026-06-22T01:00:00Z']
    const series = recurringCalendarEvent(7, occ, { calendarId: 99, calendarName: '기본', title: '주간 회의', myRole: 'ATTENDEE' })
    const { user } = renderCalendarPage('/calendar', [
      http.get('/api/v1/calendar/events/7', () => HttpResponse.json(series[0])),
      ...calendarHandlers({ calendars: [calendar({ id: 1, name: '기본', isDefault: true })], events: series }),
    ])
    await user.click(await screen.findByTestId(`calendar-event-7-${occ[1]}`))
    const time = await screen.findByTestId('event-detail-time')
    expect(time).toHaveTextContent('6월 15일 (월) · 오전 10:00 – 11:00')
    expect(time).not.toHaveTextContent('6월 8일')
    expect(screen.getByTestId('event-detail-recurrence')).toHaveTextContent('매주 월요일')
  })
})
