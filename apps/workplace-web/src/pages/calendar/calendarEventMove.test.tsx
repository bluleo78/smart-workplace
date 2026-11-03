// 일정 끌어 옮기기(WP-1328) — 캘린더 화면 테스트. 끌기 → 저장 요청(PATCH 바디·범위 쿼리), 반복 회차 범위 선택, 옮길 수 없는 일정,
// 실패하면 제자리 + 오류 토스트, 문턱 아래 클릭은 지금처럼 일정을 연다, 제자리 놓기는 요청 없음.
// jsdom 은 레이아웃·히트 테스트가 없어 포인터 이벤트를 직접 쏘고 「포인터 아래 요소」(document.elementFromPoint)만 놓을 칸으로 바꿔 끼운다.
// 실제 마우스 끌기(포인터 붙잡기·좌표)는 e2e/pages/calendar/calendar-event-move.spec.ts(@input)가 본다.
// 지금 = 2026-06-10 12:00 KST(vitest 는 TZ=Asia/Seoul).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test } from 'vitest'

import { fixClock, renderCalendar } from '@/test/kits/calendar/calendarPageKit'

import { calendar, calendarEvent, recurringCalendarEvent } from '../../../e2e/factories/calendar.factory'

fixClock()

// jsdom 의 document 에 elementFromPoint 가 없을 수 있어 테스트마다 넣고 지운다.
afterEach(() => {
  delete (document as { elementFromPoint?: unknown }).elementFromPoint
})

/**
 * source 를 마우스로 눌러 target 위까지 끌고 놓는다 — dx·dy 는 누른 점에서 움직인 거리(px).
 * jsdom 의 getBoundingClientRect 는 0 이라 시간 그리드에서 옮긴 세로 거리 = dy 다. 놓은 뒤 브라우저처럼 click 도 쏜다.
 */
function drag(source: HTMLElement, target: HTMLElement, { dx = 20, dy = 0, up = true } = {}) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  const at = (x: number, y: number) => ({ pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y })
  fireEvent.pointerDown(source, at(100, 100))
  fireEvent.pointerMove(source, at(100 + dx / 2, 100 + dy / 2))
  fireEvent.pointerMove(source, at(100 + dx, 100 + dy))
  if (!up) return
  fireEvent.pointerUp(source, at(100 + dx, 100 + dy))
  fireEvent.click(source)
}

// 6/10(수) 10:00~11:00 KST 회의 — 설명·장소·색·알림까지 채워 바디에 그대로 실리는지 본다.
const meeting = calendarEvent({
  id: 1,
  title: '팀 회의',
  description: '안건 정리',
  location: '3층 회의실',
  color: 'red',
  reminderMinutes: 10,
  startsAt: '2026-06-10T01:00:00Z',
  endsAt: '2026-06-10T02:00:00Z',
})

describe('월 보기에서 다른 날로 끌기', () => {
  test('6/10 일정을 6/12 칸에 놓으면 시각은 그대로 날짜만 바꾼 전체 바디로 PATCH 하고, 새 칸에 보인다', async () => {
    const { requests } = await renderCalendar({ events: [meeting] })
    const chip = await screen.findByTestId('calendar-event-1')
    const target = screen.getByTestId('calendar-cell-2026-06-12')

    // 끄는 중엔 놓일 칸에 미리보기가 뜬다
    drag(chip, target, { up: false })
    expect(within(target).getByTestId('calendar-move-preview')).toHaveTextContent('팀 회의')
    fireEvent.pointerUp(chip, { pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 100 })
    fireEvent.click(chip)

    await waitFor(() => expect(requests.patches).toHaveLength(1))
    const { url, body } = requests.patches[0]
    expect(url.pathname).toBe('/api/v1/calendar/events/1')
    expect(url.searchParams.get('scope')).toBeNull()
    expect(body).toEqual({
      title: '팀 회의',
      description: '안건 정리',
      startsAt: '2026-06-12T01:00:00.000Z',
      endsAt: '2026-06-12T02:00:00.000Z',
      allDay: false,
      location: '3층 회의실',
      color: 'red',
      reminderMinutes: 10,
      recurrenceRule: null,
      calendarId: 1,
    })
    // 끈 뒤의 click 은 일정을 열지 않고, 미리보기도 사라진다
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-move-preview')).not.toBeInTheDocument()
    // 저장 뒤 목록을 다시 받아 새 칸에 그린다
    expect(await within(screen.getByTestId('calendar-cell-2026-06-12')).findByTestId('calendar-event-1')).toBeInTheDocument()
    expect(within(screen.getByTestId('calendar-cell-2026-06-10')).queryByTestId('calendar-event-1')).not.toBeInTheDocument()
  })

  test('종일 일정은 종일인 채 놓은 날로 옮긴다(로컬 자정)', async () => {
    const allDay = calendarEvent({ id: 2, title: '워크숍', allDay: true, startsAt: '2026-06-09T15:00:00Z', endsAt: '2026-06-10T15:00:00Z' })
    const { requests } = await renderCalendar({ events: [allDay] })
    drag(await screen.findByTestId('calendar-event-2'), screen.getByTestId('calendar-cell-2026-06-11'))
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    expect(requests.patches[0].body).toMatchObject({
      allDay: true,
      startsAt: '2026-06-10T15:00:00.000Z',
      endsAt: '2026-06-11T15:00:00.000Z',
    })
  })

  test('같은 칸에 놓으면 요청하지 않고 일정도 열지 않는다', async () => {
    const { requests } = await renderCalendar({ events: [meeting] })
    drag(await screen.findByTestId('calendar-event-1'), screen.getByTestId('calendar-cell-2026-06-10'))
    // 부재 확인 — 요청이 나갈 틈(다음 틱)을 준 뒤 본다
    await new Promise((r) => setTimeout(r, 50))
    expect(requests.patches).toHaveLength(0)
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
  })

  test('문턱(4px) 아래로 움직이고 놓으면 끌기가 아니라 지금처럼 일정을 연다', async () => {
    const { requests } = await renderCalendar({ events: [meeting] })
    drag(await screen.findByTestId('calendar-event-1'), screen.getByTestId('calendar-cell-2026-06-12'), { dx: 2 })
    expect(await screen.findByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.patches).toHaveLength(0)
  })

  test('끄는 중 Esc 를 누르면 취소된다 — 놓아도 저장하지 않고 일정 창도 열지 않는다', async () => {
    const { requests } = await renderCalendar({ events: [meeting] })
    const chip = await screen.findByTestId('calendar-event-1')
    drag(chip, screen.getByTestId('calendar-cell-2026-06-12'), { up: false })
    expect(screen.getByTestId('calendar-move-preview')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('calendar-move-preview')).not.toBeInTheDocument()
    fireEvent.pointerUp(chip, { pointerId: 1, pointerType: 'mouse', clientX: 120, clientY: 100 })
    fireEvent.click(chip)
    await new Promise((r) => setTimeout(r, 50))
    expect(requests.patches).toHaveLength(0)
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
  })

  test('칩 밖에서 놓쳐 남은 끌기는 단추 없이 지나가는 포인터로 이어지지 않는다', async () => {
    const { requests } = await renderCalendar({ events: [meeting] })
    const chip = await screen.findByTestId('calendar-event-1')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => screen.getByTestId('calendar-cell-2026-06-12') })
    // 누른 뒤 pointerup 을 못 받은 채(칩 밖에서 놓음) 단추 없이 칩 위를 지나간다
    fireEvent.pointerDown(chip, { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(chip, { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 140, clientY: 100 })
    expect(screen.queryByTestId('calendar-move-preview')).not.toBeInTheDocument()
    fireEvent.pointerUp(chip, { pointerId: 1, pointerType: 'mouse', clientX: 140, clientY: 100 })
    await new Promise((r) => setTimeout(r, 50))
    expect(requests.patches).toHaveLength(0)
  })

  test('터치로는 끌리지 않는다', async () => {
    const { requests } = await renderCalendar({ events: [meeting] })
    const chip = await screen.findByTestId('calendar-event-1')
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => screen.getByTestId('calendar-cell-2026-06-12'),
    })
    const at = (x: number) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: 100 })
    fireEvent.pointerDown(chip, at(100))
    fireEvent.pointerMove(chip, at(140))
    expect(screen.queryByTestId('calendar-move-preview')).not.toBeInTheDocument()
    fireEvent.pointerUp(chip, at(140))
    await new Promise((r) => setTimeout(r, 50))
    expect(requests.patches).toHaveLength(0)
  })
})

describe('주 보기 시간 그리드에서 끌기', () => {
  test('아래로 한 시간(48px) 끌어 옆 요일 열에 놓으면 날짜·시각이 함께 바뀌고 길이는 그대로', async () => {
    const { user, requests } = await renderCalendar({ events: [meeting] })
    await user.click(screen.getByTestId('calendar-view-week-btn'))
    const block = await within(await screen.findByTestId('calendar-view-week')).findByTestId('calendar-event-1')
    // 6/7(일) 시작 주 — 목(6/11)은 다섯째 열
    const thursday = screen.getAllByTestId('calendar-day-column')[4]
    drag(block, thursday, { dx: 0, dy: 48, up: false })
    expect(within(thursday).getByTestId('calendar-move-preview')).toHaveTextContent('11:00 팀 회의')
    fireEvent.pointerUp(block, { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 148 })
    fireEvent.click(block)

    await waitFor(() => expect(requests.patches).toHaveLength(1))
    expect(requests.patches[0].body).toMatchObject({
      startsAt: '2026-06-11T02:00:00.000Z',
      endsAt: '2026-06-11T03:00:00.000Z',
      allDay: false,
    })
    // 칸 click(새 일정 만들기)·일정 열기 어느 쪽도 열리지 않는다
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
  })

  test('종일 일정은 종일 줄 칸으로만 옮겨지고 시간 그리드 열에는 놓이지 않는다', async () => {
    const allDay = calendarEvent({ id: 2, title: '워크숍', allDay: true, startsAt: '2026-06-09T15:00:00Z', endsAt: '2026-06-10T15:00:00Z' })
    const { user, requests } = await renderCalendar({ events: [allDay] })
    await user.click(screen.getByTestId('calendar-view-week-btn'))
    const chip = await within(await screen.findByTestId('calendar-view-week')).findByTestId('calendar-event-2')
    // 시간 그리드 열 위에 놓음 — 종일 ↔ 타임드는 바꾸지 않으므로 무시
    drag(chip, screen.getAllByTestId('calendar-day-column')[5])
    await new Promise((r) => setTimeout(r, 50))
    expect(requests.patches).toHaveLength(0)
    // 종일 줄 금(6/12) 칸에 놓음
    drag(chip, screen.getAllByTestId('calendar-allday-cell')[5])
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    expect(requests.patches[0].body).toMatchObject({ allDay: true, startsAt: '2026-06-11T15:00:00.000Z', endsAt: '2026-06-12T15:00:00.000Z' })
  })
})

describe('반복 회차 끌기', () => {
  const MASTER_ID = 5
  const OCC = ['2026-06-08T01:00:00Z', '2026-06-15T01:00:00Z']

  test('놓으면 범위 선택이 뜨고, 고른 범위와 회차 날짜로 마스터 id 에 PATCH 한다', async () => {
    const { user, requests } = await renderCalendar({ events: recurringCalendarEvent(MASTER_ID, OCC) })
    drag(await screen.findByTestId(`calendar-event-${MASTER_ID}-${OCC[0]}`), screen.getByTestId('calendar-cell-2026-06-09'))
    await screen.findByTestId('calendar-recurrence-scope-dialog')
    expect(requests.patches).toHaveLength(0)

    await user.click(screen.getByTestId('calendar-recurrence-scope-this'))
    await waitFor(() => expect(requests.patches).toHaveLength(1))
    const { url, body } = requests.patches[0]
    expect(url.pathname).toBe(`/api/v1/calendar/events/${MASTER_ID}`)
    expect(url.searchParams.get('scope')).toBe('THIS')
    expect(url.searchParams.get('occurrenceDate')).toBe(OCC[0])
    expect(body).toMatchObject({ startsAt: '2026-06-09T01:00:00.000Z', endsAt: '2026-06-09T02:00:00.000Z', recurrenceRule: 'FREQ=WEEKLY' })
    await waitFor(() => expect(screen.queryByTestId('calendar-recurrence-scope-dialog')).not.toBeInTheDocument())
    // 일정 창은 열리지 않는다
    expect(screen.queryByTestId('calendar-event-dialog')).not.toBeInTheDocument()
  })

  test('범위 선택을 취소하면 옮기지 않는다', async () => {
    const { user, requests } = await renderCalendar({ events: recurringCalendarEvent(MASTER_ID, OCC) })
    drag(await screen.findByTestId(`calendar-event-${MASTER_ID}-${OCC[0]}`), screen.getByTestId('calendar-cell-2026-06-09'))
    await screen.findByTestId('calendar-recurrence-scope-dialog')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('calendar-recurrence-scope-dialog')).not.toBeInTheDocument())
    expect(requests.patches).toHaveLength(0)
    expect(within(screen.getByTestId('calendar-cell-2026-06-08')).getByTestId(`calendar-event-${MASTER_ID}-${OCC[0]}`)).toBeInTheDocument()
  })
})

describe('옮길 수 없는 일정', () => {
  test('읽기 전용(M365) 캘린더 일정은 끌리지 않고, 누르면 지금처럼 상세가 열린다', async () => {
    const synced = calendar({ id: 2, name: 'M365', isReadOnly: true, isDefault: false, provider: 'M365_GRAPH' })
    const { requests } = await renderCalendar({
      calendars: [calendar({ id: 1 }), synced],
      events: [calendarEvent({ ...meeting, calendarId: 2 })],
    })
    drag(await screen.findByTestId('calendar-event-1'), screen.getByTestId('calendar-cell-2026-06-12'), { up: false })
    expect(screen.queryByTestId('calendar-move-preview')).not.toBeInTheDocument()
    const chip = screen.getByTestId('calendar-event-1')
    fireEvent.pointerUp(chip, { pointerId: 1, pointerType: 'mouse' })
    fireEvent.click(chip)
    expect(await screen.findByTestId('calendar-event-dialog')).toBeInTheDocument()
    expect(requests.patches).toHaveLength(0)
  })

  test('내 캘린더에 없는 초대받은 일정은 끌리지 않는다', async () => {
    const { requests } = await renderCalendar({ events: [calendarEvent({ ...meeting, calendarId: 77 })] })
    drag(await screen.findByTestId('calendar-event-1'), screen.getByTestId('calendar-cell-2026-06-12'), { up: false })
    expect(screen.queryByTestId('calendar-move-preview')).not.toBeInTheDocument()
    fireEvent.pointerUp(screen.getByTestId('calendar-event-1'), { pointerId: 1, pointerType: 'mouse' })
    await new Promise((r) => setTimeout(r, 50))
    expect(requests.patches).toHaveLength(0)
  })
})

describe('저장 실패', () => {
  test('서버가 거절하면 오류 토스트를 띄우고 일정은 원래 칸에 남는다', async () => {
    let patched = 0
    await renderCalendar(
      { events: [meeting] },
      {
        handlers: [
          http.patch('/api/v1/calendar/events/:id', () => {
            patched++
            return HttpResponse.json({ message: '주최자만 수정할 수 있습니다' }, { status: 403 })
          }),
        ],
      },
    )
    drag(await screen.findByTestId('calendar-event-1'), screen.getByTestId('calendar-cell-2026-06-12'))
    expect(await screen.findByText('주최자만 수정할 수 있습니다')).toBeInTheDocument()
    expect(patched).toBe(1)
    expect(within(screen.getByTestId('calendar-cell-2026-06-10')).getByTestId('calendar-event-1')).toBeInTheDocument()
    expect(within(screen.getByTestId('calendar-cell-2026-06-12')).queryByTestId('calendar-event-1')).not.toBeInTheDocument()
  })
})
