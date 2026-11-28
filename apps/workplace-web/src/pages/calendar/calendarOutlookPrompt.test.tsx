// Outlook 기본 캘린더 확인 창(WP-2171) — 캘린더 화면 진입·M365 연결 성공 알림 뒤 한 번 묻고, 지정·유지·실패에 따라 기록한다.
// 창은 앱 셸에 마운트되는 컴포넌트라 CalendarPage 와 나란히 renderScreen 으로 띄운다(calendarPageKit 의 ui 인자).
import { focusManager } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import { act, createElement, Fragment } from 'react'
import { describe, expect, test } from 'vitest'

import { OutlookDefaultPrompt } from '@/components/calendar/OutlookDefaultPrompt'
import { calendarKeys } from '@/hooks/queries/calendarKeys'
import { notifyOpener } from '@/lib/m365-oauth'
import { CalendarPage } from '@/pages/calendar/CalendarPage'
import { calendarApi, fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'
import { renderScreen } from '@/test/renderScreen'

import { calendar } from '../../../e2e/factories/calendar.factory'

fixClock()

const WORKS = calendar({ id: 1, name: 'Works 캘린더', color: 'blue', isDefault: true })
const OUTLOOK = calendar({
  id: 3, name: '업무', color: 'red', isDefault: false, isReadOnly: false,
  accountEmail: 'dh.yang@iacloud.kr', provider: 'M365_GRAPH',
})
const OUTLOOK_RO = calendar({
  id: 10, name: '공휴일', color: 'indigo', isDefault: false, isReadOnly: true,
  accountEmail: 'dh.yang@iacloud.kr', provider: 'M365_GRAPH',
})

const withPrompt = () => createElement(Fragment, null, createElement(CalendarPage), createElement(OutlookDefaultPrompt))
const promptEl = () => screen.queryByTestId('outlook-default-prompt')
// 다른 화면으로 갔다가 오기 — renderScreen 은 BrowserRouter 라 history 를 바꾸고 popstate 로 알린다
const go = (path: string) => act(() => {
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
})
// 다른 탭에 갔다가 이 탭으로 돌아오기(react-query 포커스 신호) — 끝나면 focusManager.setFocused(undefined) 로 되돌린다
const refocus = () => act(() => {
  focusManager.setFocused(false)
  focusManager.setFocused(true)
})
// 캘린더 밖으로 나갔다가 다시 들어오기
const revisit = () => {
  go('/home')
  go('/calendar')
}

describe('Outlook 기본 캘린더 확인 창', () => {
  test('아직 안 물었고 쓸 수 있는 Outlook 캘린더가 있으면 제목·본문과 함께 뜬다', async () => {
    await renderCalendar({ calendars: [WORKS, OUTLOOK], outlookPrompted: false }, {}, withPrompt())
    const dialog = await screen.findByTestId('outlook-default-prompt')
    expect(dialog).toHaveTextContent('새 일정 기본 캘린더')
    expect(dialog).toHaveTextContent('새 일정을 Outlook 캘린더(dh.yang@iacloud.kr)에 만들까요?')
  })

  test('Outlook 캘린더에 계정 이메일이 없으면 괄호 없이 묻는다', async () => {
    const noAccount = calendar({ ...OUTLOOK, accountEmail: null })
    await renderCalendar({ calendars: [WORKS, noAccount], outlookPrompted: false }, {}, withPrompt())
    const dialog = await screen.findByTestId('outlook-default-prompt')
    expect(dialog).toHaveTextContent('새 일정을 Outlook 캘린더에 만들까요?')
    expect(dialog).not.toHaveTextContent('(')
  })

  test('「Outlook 캘린더로 지정」은 그 id 로 PUT 한 뒤 물었음을 기록하고 창을 닫으며 「기본」 배지가 Outlook 줄로 옮긴다', async () => {
    const { user, requests } = await renderCalendar({ calendars: [WORKS, OUTLOOK], outlookPrompted: false }, {}, withPrompt())
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))

    await waitFor(() => expect(requests.settingsPuts).toEqual([{ calendarId: 3 }]))
    await waitFor(() => expect(requests.promptPosts).toHaveLength(1))
    await waitFor(() => expect(promptEl()).toBeNull())
    await waitFor(() => expect(screen.getByTestId('calendar-list-item-3').querySelector('[data-testid="calendar-default-badge"]')).not.toBeNull())
  })

  test('「지금대로 두기」는 설정을 바꾸지 않고 물었음만 기록하며 창을 닫는다', async () => {
    const { user, requests } = await renderCalendar({ calendars: [WORKS, OUTLOOK], outlookPrompted: false }, {}, withPrompt())
    await user.click(await screen.findByTestId('outlook-default-prompt-keep'))

    await waitFor(() => expect(requests.promptPosts).toHaveLength(1))
    await waitFor(() => expect(promptEl()).toBeNull())
    expect(requests.settingsPuts).toHaveLength(0)
  })

  test('지정이 409 로 실패하면 물었음을 기록하지 않고(다음에 다시 묻는다) 창은 닫는다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, settingsPutStatus: 409 }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))

    await waitFor(() => expect(requests.settingsPuts).toHaveLength(1))
    await waitFor(() => expect(promptEl()).toBeNull())
    expect(requests.promptPosts).toHaveLength(0)
  })

  test('지정이 409 로 실패한 뒤 캘린더 화면에 다시 들어오면 다시 묻는다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, settingsPutStatus: 409 }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))
    await waitFor(() => expect(promptEl()).toBeNull())

    revisit()
    expect(await screen.findByTestId('outlook-default-prompt')).toBeInTheDocument()
    expect(requests.promptPosts).toHaveLength(0)
  })

  test('409 뒤 재진입에서 다시 뜬 창을 답하지 않고 떠나면 캘린더 밖에서는 조회하지도 창을 띄우지도 않는다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, settingsPutStatus: 409 }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))
    await waitFor(() => expect(promptEl()).toBeNull())
    revisit()
    // 재진입에서 다시 뜬 창(409 라 아직 안 물음) — 답하지 않고 캘린더를 떠난다
    await screen.findByTestId('outlook-default-prompt')
    go('/home')
    await waitFor(() => expect(promptEl()).toBeNull())
    const gets = requests.settingsGets
    refocus()
    // 뜨지 않음·조회 없음(부재)을 보는 단언이라 고정 대기
    await new Promise((r) => setTimeout(r, 300))
    act(() => focusManager.setFocused(undefined))
    expect(promptEl()).toBeNull()
    expect(requests.settingsGets).toBe(gets)
  })

  test('지정이 409 로 두 번 실패하면 물었음으로 기록해 더 묻지 않는다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, settingsPutStatus: 409 }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))
    await waitFor(() => expect(promptEl()).toBeNull())
    revisit()
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))
    await waitFor(() => expect(requests.promptPosts).toHaveLength(1))

    revisit()
    // 뜨지 않음(부재)을 보는 단언이라 고정 대기 — 뜰 것이었다면 이 사이 설정·목록 응답으로 열렸다
    await new Promise((r) => setTimeout(r, 200))
    expect(promptEl()).toBeNull()
  })

  test('창이 열린 채 다른 탭에서 답하면 이 탭으로 돌아올 때 설정을 다시 읽어 창이 닫힌다', async () => {
    const { state } = await renderCalendar({ calendars: [WORKS, OUTLOOK], outlookPrompted: false }, {}, withPrompt())
    await screen.findByTestId('outlook-default-prompt')
    // 다른 탭이 「지금대로 두기」로 기록한 상황
    state.outlookPrompted = true
    refocus()
    await waitFor(() => expect(promptEl()).toBeNull())
    act(() => focusManager.setFocused(undefined))
  })

  test('물었음 기록이 실패하면 캘린더 화면에 다시 들어올 때 다시 묻고, 다시 기록한다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, promptPostStatus: 500 }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-keep'))
    await waitFor(() => expect(requests.promptPosts).toHaveLength(1))
    await waitFor(() => expect(promptEl()).toBeNull())

    revisit()
    await user.click(await screen.findByTestId('outlook-default-prompt-keep'))
    await waitFor(() => expect(requests.promptPosts).toHaveLength(2))
  })

  test('지정이 403(쓰기 권한 없음)으로 실패하면 물었음을 기록한다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, settingsPutStatus: 403 }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))

    await waitFor(() => expect(requests.promptPosts).toHaveLength(1))
    await waitFor(() => expect(promptEl()).toBeNull())
  })

  test('지정 요청 중에 Esc 를 눌러도 닫히지 않고 물었음도 기록되지 않는다', async () => {
    const { user, requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, settingsPutStatus: 409, holdPut: () => new Promise((r) => setTimeout(r, 300)) }, {}, withPrompt(),
    )
    await user.click(await screen.findByTestId('outlook-default-prompt-set'))
    await user.keyboard('{Escape}')
    expect(promptEl()).not.toBeNull()
    await waitFor(() => expect(promptEl()).toBeNull())
    expect(requests.promptPosts).toHaveLength(0)
  })

  test('이미 물었으면 창이 없다', async () => {
    const { requests } = await renderCalendar({ calendars: [WORKS, OUTLOOK], outlookPrompted: true }, {}, withPrompt())
    await waitFor(() => expect(requests.settingsGets).toBeGreaterThan(0))
    expect(promptEl()).toBeNull()
    expect(requests.promptPosts).toHaveLength(0)
  })

  test('읽기 전용 Outlook 캘린더뿐이면 창이 없다', async () => {
    const { requests } = await renderCalendar({ calendars: [WORKS, OUTLOOK_RO], outlookPrompted: false }, {}, withPrompt())
    await waitFor(() => expect(requests.settingsGets).toBeGreaterThan(0))
    expect(promptEl()).toBeNull()
    expect(requests.promptPosts).toHaveLength(0)
  })

  test('기본이 이미 Outlook 캘린더면 창 없이 물었음만 기록한다', async () => {
    const { requests } = await renderCalendar(
      { calendars: [WORKS, OUTLOOK], outlookPrompted: false, defaultCalendarId: 3 }, {}, withPrompt(),
    )
    await waitFor(() => expect(requests.promptPosts).toHaveLength(1))
    expect(promptEl()).toBeNull()
  })
})

describe('M365 연결 성공 알림', () => {
  test('캘린더 밖에서는 조회하지 않다가 연결 성공 알림을 받으면 다시 조회하고 창이 뜬다', async () => {
    const api = calendarApi({ calendars: [WORKS, OUTLOOK], outlookPrompted: false })
    renderScreen(createElement(OutlookDefaultPrompt), { path: '/home', handlers: api.handlers })
    // 캘린더 화면도 연결 직후도 아니면 캘린더·설정을 조회하지 않는다
    await new Promise((r) => setTimeout(r, 200))
    expect(api.requests.settingsGets).toBe(0)
    expect(promptEl()).toBeNull()

    // 팝업이 보낸 알림(동일 출처 postMessage) — jsdom 의 postMessage origin 이 어긋날 수 있어 MessageEvent 를 직접 보낸다
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'm365-oauth', ok: true }, origin: window.location.origin }))
    })
    expect(await screen.findByTestId('outlook-default-prompt')).toHaveTextContent('dh.yang@iacloud.kr')
    expect(api.requests.settingsGets).toBeGreaterThan(0)
  })

  test('연결 직후엔 Outlook 캘린더가 없다가 나중 응답에 생기면 다시 읽어 창이 뜬다', async () => {
    const api = calendarApi({ calendars: [WORKS], outlookPrompted: false })
    renderScreen(createElement(OutlookDefaultPrompt, { pollMs: 50, connectWindowMs: 5000 }), { path: '/home', handlers: api.handlers })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'm365-oauth', ok: true }, origin: window.location.origin }))
    })
    await waitFor(() => expect(api.requests.settingsGets).toBeGreaterThan(0))
    expect(promptEl()).toBeNull()

    // 백그라운드 동기화가 끝나 Outlook 캘린더가 목록에 생긴다
    api.state.calendars = [WORKS, OUTLOOK]
    expect(await screen.findByTestId('outlook-default-prompt')).toHaveTextContent('dh.yang@iacloud.kr')
  })

  test('기다리는 시간이 지나도록 Outlook 캘린더가 없으면 그 뒤에 생겨도 창이 뜨지 않는다', async () => {
    const api = calendarApi({ calendars: [WORKS], outlookPrompted: false })
    renderScreen(createElement(OutlookDefaultPrompt, { pollMs: 50, connectWindowMs: 300 }), { path: '/home', handlers: api.handlers })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'm365-oauth', ok: true }, origin: window.location.origin }))
    })
    await waitFor(() => expect(api.requests.settingsGets).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 700))

    api.state.calendars = [WORKS, OUTLOOK]
    await new Promise((r) => setTimeout(r, 400))
    expect(promptEl()).toBeNull()
    expect(api.requests.promptPosts).toHaveLength(0)
  })

  test('기다림이 끝난 뒤 다른 관찰자가 캘린더 캐시에 Outlook 캘린더를 채워도 창이 뜨지 않는다', async () => {
    const api = calendarApi({ calendars: [WORKS], outlookPrompted: false })
    const { queryClient } = renderScreen(createElement(OutlookDefaultPrompt, { pollMs: 50, connectWindowMs: 300 }), { path: '/home', handlers: api.handlers })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'm365-oauth', ok: true }, origin: window.location.origin }))
    })
    await waitFor(() => expect(api.requests.settingsGets).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 700))

    // 다른 화면의 관찰자가 공유 캐시를 갱신한 상황
    act(() => {
      queryClient.setQueryData(calendarKeys.calendars, [WORKS, OUTLOOK])
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(promptEl()).toBeNull()
    expect(api.requests.promptPosts).toHaveLength(0)
  })

  test('다른 탭의 팝업이 BroadcastChannel 로 보낸 연결 성공 알림에도 창이 뜬다(연결을 시작하지 않은 탭)', async () => {
    const api = calendarApi({ calendars: [WORKS, OUTLOOK], outlookPrompted: false })
    renderScreen(createElement(OutlookDefaultPrompt), { path: '/home', handlers: api.handlers })
    // 이 탭은 팝업의 opener 가 아니다 — 팝업의 notifyOpener 가 opener 없이 BroadcastChannel 로만 알린다
    act(() => {
      notifyOpener({ source: 'm365-oauth', ok: true })
    })
    expect(await screen.findByTestId('outlook-default-prompt')).toHaveTextContent('dh.yang@iacloud.kr')
  })

  test('캘린더 밖에서 연결 알림으로 뜬 창은 기다림이 끝나도, 캘린더를 들렀다 나와도 답할 때까지 남는다', async () => {
    const api = calendarApi({ calendars: [WORKS, OUTLOOK], outlookPrompted: false })
    renderScreen(createElement(OutlookDefaultPrompt, { pollMs: 50, connectWindowMs: 200 }), { path: '/home', handlers: api.handlers })
    act(() => {
      notifyOpener({ source: 'm365-oauth', ok: true })
    })
    await screen.findByTestId('outlook-default-prompt')
    // 기다림(200ms)이 끝난 뒤에도 남는다
    await new Promise((r) => setTimeout(r, 400))
    expect(promptEl()).not.toBeNull()
    revisit()
    go('/home')
    expect(await screen.findByTestId('outlook-default-prompt')).toBeInTheDocument()
  })

  test('실패 알림(ok: false)·다른 출처의 알림은 무시한다', async () => {
    const api = calendarApi({ calendars: [WORKS, OUTLOOK], outlookPrompted: false })
    renderScreen(createElement(OutlookDefaultPrompt), { path: '/home', handlers: api.handlers })
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'm365-oauth', ok: false }, origin: window.location.origin }))
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'm365-oauth', ok: true }, origin: 'https://evil.example' }))
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(api.requests.settingsGets).toBe(0)
    expect(promptEl()).toBeNull()
  })
})
