// 새 일정 기본 캘린더(WP-2169) — 사이드바 ⋯ 메뉴의 「기본으로 지정」·「기본」 배지와, 새 일정 창의 캘린더 처음 값·「· Outlook」 표시.
// 지정 요청 본문(PUT /calendar/settings)·배지 이동·처음 값 폴백(설정 없음·조회 실패·늦게 도착)은 브라우저 없이 판정되므로 화면 테스트로 본다.
// 사이드바와 새 일정 창이 한 화면에서 이어지므로 CalendarPage 를 renderScreen 으로 띄운다(calendarPageKit). 지금 = 2026-06-10 12:00 KST.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import { calendar } from '../../../e2e/factories/calendar.factory'

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
