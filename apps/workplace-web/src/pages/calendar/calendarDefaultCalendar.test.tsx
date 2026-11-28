// 새 일정 기본 캘린더(WP-2169) — 사이드바 ⋯ 메뉴의 「기본으로 지정」·「기본」 배지와, 새 일정 창의 캘린더 처음 값·「· Outlook」 표시.
// 지정 요청 본문(PUT /calendar/settings)·배지 이동·처음 값 폴백(설정 없음·조회 실패·늦게 도착)은 브라우저 없이 판정되므로 화면 테스트로 본다.
// 사이드바와 새 일정 창이 한 화면에서 이어지므로 CalendarPage 를 renderScreen 으로 띄운다(calendarPageKit). 지금 = 2026-06-10 12:00 KST.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import { calendar, calendarEvent } from '../../../e2e/factories/calendar.factory'

fixClock()

const WORKS = calendar({ id: 1, name: 'Works 캘린더', color: 'blue', isDefault: true })
const TEAM = calendar({ id: 2, name: '팀 일정', color: 'green', isDefault: false, position: 1 })
const OUTLOOK = calendar({
  id: 3, name: '업무', color: 'red', isDefault: false, isReadOnly: false,
  accountEmail: 'dh.yang@iacloud.kr', provider: 'M365_GRAPH',
})
const OUTLOOK_RO = calendar({
  id: 10, name: '공휴일', color: 'indigo', isDefault: false, isReadOnly: true,
  accountEmail: 'dh.yang@iacloud.kr', provider: 'M365_GRAPH',
})
const CALENDARS = [WORKS, TEAM, OUTLOOK, OUTLOOK_RO]

/** 캘린더 줄의 「기본」 배지 */
const badgeIn = (id: number) => within(screen.getByTestId(`calendar-list-item-${id}`)).queryByTestId('calendar-default-badge')

describe('사이드바 — 기본 캘린더 지정', () => {
  test('설정이 없으면 Works 캘린더 줄에만 「기본」 배지가 있다', async () => {
    await renderCalendar({ calendars: CALENDARS })
    await waitFor(() => expect(badgeIn(1)).toHaveTextContent('기본'))
    expect(badgeIn(2)).toBeNull()
    expect(badgeIn(3)).toBeNull()
    expect(screen.getAllByTestId('calendar-default-badge')).toHaveLength(1)
  })

  test('쓰기 가능한 Outlook 캘린더 ⋯ 메뉴의 「기본으로 지정」은 그 id 로 PUT 하고, 응답 뒤 배지가 그 줄로 옮긴다', async () => {
    const { user, requests } = await renderCalendar({ calendars: CALENDARS })
    await waitFor(() => expect(badgeIn(1)).not.toBeNull())
    await user.click(screen.getByTestId('calendar-menu-3'))
    await user.click(await screen.findByTestId('calendar-set-default-3'))

    await waitFor(() => expect(requests.settingsPuts).toEqual([{ calendarId: 3 }]))
    await waitFor(() => expect(badgeIn(3)).toHaveTextContent('기본'))
    expect(badgeIn(1)).toBeNull()
  })

  test('읽기 전용 캘린더는 ⋯ 메뉴가 없고, 지금 기본인 캘린더 메뉴엔 「기본으로 지정」이 없다', async () => {
    const { user } = await renderCalendar({ calendars: CALENDARS, defaultCalendarId: 2 })
    await waitFor(() => expect(badgeIn(2)).not.toBeNull())
    expect(screen.queryByTestId('calendar-menu-10')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('calendar-menu-2'))
    expect(await screen.findByTestId('calendar-edit-2')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-set-default-2')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    // Works 캘린더는 지금 기본이 아니므로 지정할 수 있다
    await user.click(screen.getByTestId('calendar-menu-1'))
    expect(await screen.findByTestId('calendar-set-default-1')).toHaveTextContent('기본으로 지정')
  })

  test('설정(캐시)이 읽기 전용이 된 캘린더를 가리켜도 배지는 그 줄이 아니라 Works 캘린더에 단다(리뷰 후속)', async () => {
    await renderCalendar({ calendars: CALENDARS, defaultCalendarId: 10 })
    await waitFor(() => expect(badgeIn(1)).toHaveTextContent('기본'))
    expect(badgeIn(10)).toBeNull()
    expect(screen.getAllByTestId('calendar-default-badge')).toHaveLength(1)
  })

  test('긴 캘린더 이름은 말줄임되고 전체 이름을 title 로 보여 준다', async () => {
    const long = calendar({ id: 4, name: '아주 긴 이름의 프로젝트 공유 캘린더 이름입니다', isDefault: false, position: 2 })
    await renderCalendar({ calendars: [WORKS, long] })
    const name = within(screen.getByTestId('calendar-list-item-4')).getByText(long.name)
    expect(name).toHaveClass('truncate')
    expect(name).toHaveAttribute('title', long.name)
  })
})

describe('새 일정 — 캘린더 처음 값', () => {
  test('설정이 Outlook 캘린더면 처음 값이 그 캘린더이고 이름 뒤에 「· Outlook」이 붙는다', async () => {
    const { user } = await renderCalendar({ calendars: CALENDARS, defaultCalendarId: 3 })
    await user.click(screen.getByTestId('calendar-new-event'))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook'))

    await user.click(screen.getByTestId('calendar-form-calendar'))
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).toEqual(['Works 캘린더', '팀 일정', '업무 · Outlook'])
  })

  test('설정이 없으면(null) Works 캘린더가 처음 값이다', async () => {
    const { user } = await renderCalendar({ calendars: CALENDARS })
    await user.click(screen.getByTestId('calendar-new-event'))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더'))
  })

  test('설정 조회가 실패해도(500) Works 캘린더가 처음 값이고 그대로 저장된다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: CALENDARS },
      { handlers: [http.get('/api/v1/calendar/settings', () => HttpResponse.json({ message: '오류' }, { status: 500 }))] },
    )
    await user.click(screen.getByTestId('calendar-new-event'))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더'))
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('조회 실패 일정')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(requests.posts[0]).toMatchObject({ calendarId: 1 })
  })

  test('설정이 창을 연 뒤 늦게 오면 아직 고르지 않은 처음 값을 그 캘린더로 바꾸고, 입력은 지우지 않는다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: CALENDARS },
      {
        handlers: [
          http.get('/api/v1/calendar/settings', async () => {
            await delay(400)
            return HttpResponse.json({ defaultCalendarId: 3 })
          }),
        ],
      },
    )
    await user.click(screen.getByTestId('calendar-new-event'))
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('늦은 설정 일정')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook'), { timeout: 3000 })
    expect(screen.getByTestId('calendar-form-title')).toHaveValue('늦은 설정 일정')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(requests.posts[0]).toMatchObject({ calendarId: 3, title: '늦은 설정 일정' })
  })

  test('설정이 늦게 와도 사용자가 이미 고른 캘린더는 바꾸지 않는다', async () => {
    const { user } = await renderCalendar(
      { calendars: CALENDARS },
      {
        handlers: [
          http.get('/api/v1/calendar/settings', async () => {
            await delay(600)
            return HttpResponse.json({ defaultCalendarId: 3 })
          }),
        ],
      },
    )
    await user.click(screen.getByTestId('calendar-new-event'))
    await user.click(await screen.findByTestId('calendar-form-calendar'))
    await user.click(await screen.findByRole('option', { name: '팀 일정' }))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('팀 일정'))
    // 설정 응답이 실제로 도착(캐시 반영)한 뒤에도 고른 값이 남는다 — 사이드바 「기본」 배지가 Outlook 으로 옮겨 가면 응답이 반영된 것이다
    await waitFor(() => expect(badgeIn(3)).toHaveTextContent('기본'), { timeout: 3000 })
    expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('팀 일정')
  })

  test('설정 캘린더가 읽기 전용이거나 목록에 없으면 Works 캘린더로 폴백한다', async () => {
    const { user } = await renderCalendar({ calendars: CALENDARS, defaultCalendarId: 10 })
    await user.click(screen.getByTestId('calendar-new-event'))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더'))
  })
})

// 반복 전환·안내(WP-2170) — 서버는 Outlook 캘린더의 반복 일정 생성을 422 로 막는다(에픽 WP-2168). 화면이 먼저 Works 로 옮기고 안내한다.
describe('새 일정 — Outlook 반복·참석자 안내(WP-2170)', () => {
  const HINT = 'calendar-form-recurrence-works-hint'

  /** 설정 defaultCalendarId=3(Outlook) 으로 새 일정 창을 연다 */
  async function openNewWithOutlook(extra: Parameters<typeof renderCalendar>[1] = {}) {
    const view = await renderCalendar({ calendars: CALENDARS, defaultCalendarId: 3 }, extra)
    await view.user.click(screen.getByTestId('calendar-new-event'))
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook'))
    return view
  }

  /** 반복 빈도 Select 에서 항목을 고른다 */
  async function pickFreq(user: Awaited<ReturnType<typeof renderCalendar>>['user'], name: string) {
    await user.click(screen.getByTestId('calendar-form-recurrence-freq'))
    await user.click(await screen.findByRole('option', { name }))
  }

  test('Outlook 이 처음 값인 새 일정에서 반복을 켜면 Works 캘린더로 바뀌고 안내가 보이며 저장 POST 가 Works 로 간다(WP-2170)', async () => {
    const { user, requests } = await openNewWithOutlook()
    await pickFreq(user, '매주')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더'))
    expect(screen.getByTestId(HINT)).toBeInTheDocument()
    await user.click(screen.getByTestId('calendar-form-title'))
    await user.paste('반복 일정')
    await user.click(screen.getByTestId('calendar-form-submit'))
    await waitFor(() => expect(requests.posts).toHaveLength(1))
    expect(requests.posts[0]).toMatchObject({ calendarId: 1 })
    expect(requests.posts[0].recurrenceRule).toBeTruthy()
  })

  test('반복을 다시 끄면 원래 Outlook 캘린더로 돌아오고 반복 안내가 사라진다(WP-2170)', async () => {
    const { user } = await openNewWithOutlook()
    await pickFreq(user, '매주')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더'))
    await pickFreq(user, '반복 안 함')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook'))
    expect(screen.queryByTestId(HINT)).not.toBeInTheDocument()
  })

  test('반복이 켜진 새 일정에서는 Outlook 캘린더 항목을 고를 수 없다(WP-2170)', async () => {
    const { user } = await openNewWithOutlook()
    await pickFreq(user, '매주')
    await user.click(screen.getByTestId('calendar-form-calendar'))
    const option = await screen.findByRole('option', { name: '업무 · Outlook' })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: '팀 일정' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('Outlook 이 선택돼 있으면 참석자 아래 안내가 보이고 Works 로 바꾸면 사라진다(WP-2170)', async () => {
    const { user } = await openNewWithOutlook()
    expect(screen.getByTestId('calendar-form-attendee-outlook-hint')).toHaveTextContent('초대 메일은 Outlook 발송')
    await user.click(screen.getByTestId('calendar-form-calendar'))
    await user.click(await screen.findByRole('option', { name: 'Works 캘린더' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-form-attendee-outlook-hint')).not.toBeInTheDocument())
  })

  test('반복 전환 뒤 설정 응답이 늦게 와도 Outlook 으로 되돌아가지 않는다(WP-2170)', async () => {
    const { user } = await renderCalendar(
      { calendars: CALENDARS },
      {
        handlers: [
          http.get('/api/v1/calendar/settings', async () => {
            await delay(600)
            return HttpResponse.json({ defaultCalendarId: 3 })
          }),
        ],
      },
    )
    await user.click(screen.getByTestId('calendar-new-event'))
    await user.click(await screen.findByTestId('calendar-form-calendar'))
    await user.click(await screen.findByRole('option', { name: '업무 · Outlook' }))
    await pickFreq(user, '매주')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더'))
    // 설정 응답이 반영(배지 이동)된 뒤에도 Works 가 남는다
    await waitFor(() => expect(badgeIn(3)).toHaveTextContent('기본'), { timeout: 3000 })
    expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더')
  })

  test('반복을 먼저 켠 뒤 Outlook 기본 설정이 늦게 와도 Works 에 남고 안내가 보이며, 반복을 끄면 Outlook 이 된다(WP-2170)', async () => {
    const { user } = await renderCalendar(
      { calendars: CALENDARS },
      {
        handlers: [
          http.get('/api/v1/calendar/settings', async () => {
            await delay(600)
            return HttpResponse.json({ defaultCalendarId: 3 })
          }),
        ],
      },
    )
    await user.click(screen.getByTestId('calendar-new-event'))
    await pickFreq(user, '매주')
    await waitFor(() => expect(badgeIn(3)).toHaveTextContent('기본'), { timeout: 3000 })
    expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('Works 캘린더')
    expect(screen.getByTestId(HINT)).toBeInTheDocument()
    await pickFreq(user, '반복 안 함')
    await waitFor(() => expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook'))
    expect(screen.queryByTestId(HINT)).not.toBeInTheDocument()
  })

  test('편집 모드에서는 반복을 바꿔도 캘린더가 바뀌지 않고 반복 안내가 없다(WP-2170)', async () => {
    const ev = calendarEvent({
      id: 10, title: '기존 일정', calendarId: 3, color: null, effectiveColor: 'red',
      startsAt: '2026-06-10T01:00:00Z', endsAt: '2026-06-10T02:00:00Z', myRole: 'ORGANIZER',
    })
    const { user } = await renderCalendar({ calendars: CALENDARS, defaultCalendarId: 3, events: [{ ...ev, attendees: [] }] })
    await user.click(await screen.findByTestId('calendar-event-10'))
    expect(await screen.findByTestId('calendar-form-title')).toHaveValue('기존 일정')
    // Outlook 일정이라야 「편집에서는 전환하지 않는다」가 의미 있다 — 새 일정이면 여기서 Works 로 바뀐다
    expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook')
    await pickFreq(user, '매주')
    expect(screen.getByTestId('calendar-form-calendar')).toHaveTextContent('업무 · Outlook')
    expect(screen.queryByTestId(HINT)).not.toBeInTheDocument()
  })
})
