// MonthView 테스트 — 접근성(WP-1906: grid 구조·날짜 칸 이름·로빙 tabIndex·키보드)과
// 렌더 비용(WP-1917: 잰 행 높이를 기억해 첫 렌더부터 쓰고, 일정을 날짜별로 한 번만 나눈다).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isSameDay } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetMonthRowHeightForTest } from '@/lib/monthRowHeight'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { calendarEvent } from '../../../../e2e/factories/calendar.factory'
import { MonthView } from './MonthView'

const TODAY_NAME = '2026년 11월 21일 토요일, 오늘'

function setup(withEvent = false) {
  const onCreateAt = vi.fn()
  const props = {
    events: withEvent ? [calendarEvent({ id: 1, title: '회의', startsAt: '2026-11-21T01:00:00Z', endsAt: '2026-11-21T02:00:00Z' })] : [],
    issueDues: [],
    onCreateAt,
    onSelectEvent: vi.fn(),
    onSelectIssue: vi.fn(),
  }
  const view = renderWithProviders(<MonthView {...props} anchor={new Date(2026, 10, 1)} />)
  const rerenderAt = (anchor: Date) => view.rerender(<MonthView {...props} anchor={anchor} />)
  return { onCreateAt, rerenderAt }
}

const zeroTabCells = () => screen.getAllByRole('gridcell').filter((c) => c.tabIndex === 0)

describe('MonthView 접근성', () => {
  beforeEach(() => {
    // 오늘을 고정 — Date 만 가짜로 해 userEvent 타이머는 그대로 둔다.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 21, 10))
  })
  afterEach(() => vi.useRealTimers())

  it('grid·columnheader·row·gridcell 구조와 이름', () => {
    setup()
    const grid = screen.getByRole('grid', { name: '2026년 11월' })
    const headers = within(grid).getAllByRole('columnheader')
    expect(headers).toHaveLength(7)
    expect(headers[0]).toHaveAccessibleName('일요일')
    expect(within(grid).getAllByRole('row')).toHaveLength(7)
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(42)
  })

  it('오늘 칸만 tabIndex 0', () => {
    setup()
    expect(screen.getByRole('gridcell', { name: TODAY_NAME }).tabIndex).toBe(0)
    expect(zeroTabCells()).toHaveLength(1)
    expect(screen.getAllByRole('gridcell').filter((c) => c.tabIndex === -1)).toHaveLength(41)
  })

  it('방향키로 초점이 옮겨 가고 tabIndex 0 은 그 칸 하나', async () => {
    const user = userEvent.setup()
    setup()
    screen.getByRole('gridcell', { name: TODAY_NAME }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toHaveAccessibleName('2026년 11월 22일 일요일')
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveAccessibleName('2026년 11월 29일 일요일')
    expect(zeroTabCells()).toHaveLength(1)
    expect(zeroTabCells()[0]).toBe(document.activeElement)
  })

  it('Enter·Space 는 그 칸 날짜로 onCreateAt, Space 는 기본 동작을 막는다', async () => {
    const user = userEvent.setup()
    const { onCreateAt } = setup()
    const cell = screen.getByRole('gridcell', { name: TODAY_NAME })
    cell.focus()
    await user.keyboard('{Enter}')
    expect(onCreateAt).toHaveBeenCalledTimes(1)
    expect(isSameDay(onCreateAt.mock.calls[0][0], new Date(2026, 10, 21))).toBe(true)
    await user.keyboard(' ')
    expect(onCreateAt).toHaveBeenCalledTimes(2)
    expect(isSameDay(onCreateAt.mock.calls[1][0], new Date(2026, 10, 21))).toBe(true)
    // fireEvent 는 기본 동작이 막히면 false 를 돌려준다.
    expect(fireEvent.keyDown(cell, { key: ' ' })).toBe(false)
    expect(fireEvent.keyDown(cell, { key: 'ArrowLeft' })).toBe(false)
  })

  it('Alt·Ctrl·Meta 와 함께 누른 키는 가로채지 않는다', () => {
    setup()
    const cell = screen.getByRole('gridcell', { name: TODAY_NAME })
    cell.focus()
    expect(fireEvent.keyDown(cell, { key: 'ArrowRight', altKey: true })).toBe(true)
    expect(document.activeElement).toBe(cell)
  })

  it('칸 안 일정 칩의 Enter·방향키는 칸의 새 일정·이동을 일으키지 않는다', () => {
    const { onCreateAt } = setup(true)
    const chip = screen.getByRole('button', { name: /회의/ })
    chip.focus()
    fireEvent.keyDown(chip, { key: 'Enter' })
    fireEvent.keyDown(chip, { key: 'ArrowRight' })
    expect(onCreateAt).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(chip)
  })

  it('달이 바뀌어 오늘이 없으면 그달 1일이 유일한 Tab 정지점', () => {
    const { rerenderAt } = setup()
    rerenderAt(new Date(2026, 11, 1))
    expect(zeroTabCells()).toHaveLength(1)
    expect(zeroTabCells()[0]).toHaveAccessibleName('2026년 12월 1일 화요일')
  })

  it('칸을 클릭하면 그 칸이 초점 칸이 된다', async () => {
    const user = userEvent.setup()
    const { onCreateAt } = setup()
    await user.click(screen.getByRole('gridcell', { name: '2026년 11월 5일 목요일' }))
    expect(onCreateAt).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('gridcell', { name: '2026년 11월 5일 목요일' }).tabIndex).toBe(0)
    expect(zeroTabCells()).toHaveLength(1)
  })

  it('칸 이름은 그대로 두고 그날 일정·마감 이슈 개수를 설명으로 잇는다', () => {
    const events = [
      calendarEvent({ id: 1, title: '회의', startsAt: '2026-11-21T01:00:00Z', endsAt: '2026-11-21T02:00:00Z' }),
      calendarEvent({ id: 2, title: '점심', startsAt: '2026-11-21T03:00:00Z', endsAt: '2026-11-21T04:00:00Z' }),
    ]
    const issueDues = [{ issueId: 7, projectKey: 'WP', number: 7, title: '마감', dueDate: '2026-11-21' }] as unknown as IssueDueMarker[]
    renderWithProviders(
      <MonthView events={events} issueDues={issueDues} anchor={new Date(2026, 10, 1)} onCreateAt={vi.fn()} onSelectEvent={vi.fn()} onSelectIssue={vi.fn()} />,
    )
    const cell = screen.getByRole('gridcell', { name: TODAY_NAME })
    expect(cell).toHaveAccessibleDescription('일정 2개, 마감 이슈 1개')
    expect(screen.getByRole('gridcell', { name: '2026년 11월 5일 목요일' })).toHaveAccessibleDescription('')
  })

  it('「+N」 트리거의 Enter·방향키는 칸의 새 일정·이동을 일으키지 않고 초점도 그대로', () => {
    // jsdom 은 칸 높이가 0 이라 측정 전 값(3건)만 그린다 — 일정 5건이면 「+2」 버튼이 나온다.
    const events = [1, 2, 3, 4, 5].map((n) =>
      calendarEvent({ id: n, title: `일정 ${n}`, startsAt: `2026-11-21T0${n}:00:00Z`, endsAt: `2026-11-21T0${n}:30:00Z` }),
    )
    const onCreateAt = vi.fn()
    renderWithProviders(
      <MonthView events={events} issueDues={[]} anchor={new Date(2026, 10, 1)} onCreateAt={onCreateAt} onSelectEvent={vi.fn()} onSelectIssue={vi.fn()} />,
    )
    const more = screen.getByTestId('calendar-more-2026-11-21')
    more.focus()
    fireEvent.keyDown(more, { key: 'Enter' })
    fireEvent.keyDown(more, { key: 'ArrowRight' })
    expect(onCreateAt).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(more)
  })

  it('「+N」 팝오버는 「{날짜} 일정 목록」 이름을 가진다(WP-2067)', async () => {
    const user = userEvent.setup()
    const events = [1, 2, 3, 4, 5].map((n) =>
      calendarEvent({ id: n, title: `일정 ${n}`, startsAt: `2026-11-21T0${n}:00:00Z`, endsAt: `2026-11-21T0${n}:30:00Z` }),
    )
    renderWithProviders(
      <MonthView events={events} issueDues={[]} anchor={new Date(2026, 10, 1)} onCreateAt={vi.fn()} onSelectEvent={vi.fn()} onSelectIssue={vi.fn()} />,
    )
    await user.click(screen.getByTestId('calendar-more-2026-11-21'))
    expect(await screen.findByRole('dialog', { name: '11월 21일 일정 목록' })).toBeInTheDocument()
  })

  it('마감 이슈가 든 날의 「+N」 팝오버는 「{날짜} 일정·마감 이슈 목록」 이름을 가진다(WP-2067 리뷰)', async () => {
    const user = userEvent.setup()
    // 일정 없이 마감 이슈만 5건 — 넘친 칸의 트리거·팝오버 모두 마감 이슈를 말해야 한다.
    const issueDues = [1, 2, 3, 4, 5].map((n) => ({ issueId: n, projectKey: 'WP', number: n, title: `마감 ${n}`, dueDate: '2026-11-21' })) as unknown as IssueDueMarker[]
    renderWithProviders(
      <MonthView events={[]} issueDues={issueDues} anchor={new Date(2026, 10, 1)} onCreateAt={vi.fn()} onSelectEvent={vi.fn()} onSelectIssue={vi.fn()} />,
    )
    await user.click(screen.getByTestId('calendar-more-2026-11-21'))
    expect(await screen.findByRole('dialog', { name: '11월 21일 일정·마감 이슈 목록' })).toBeInTheDocument()
  })

  it('초점이 tabIndex=-1 칸에도 가면 그 칸이 로빙 초점 칸이 된다(리뷰 후속 1)', () => {
    setup()
    const cell = screen.getByRole('gridcell', { name: '2026년 11월 18일 수요일' })
    expect(cell.tabIndex).toBe(-1)
    act(() => cell.focus())
    expect(cell.tabIndex).toBe(0)
    expect(zeroTabCells()).toHaveLength(1)
    expect(zeroTabCells()[0]).toBe(cell)
  })

  it('Enter 을 길게 누르면(ev.repeat) 한 번만 연다(리뷰 후속 3)', () => {
    const { onCreateAt } = setup()
    const cell = screen.getByRole('gridcell', { name: TODAY_NAME })
    cell.focus()
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.keyDown(cell, { key: 'Enter', repeat: true })
    fireEvent.keyDown(cell, { key: 'Enter', repeat: true })
    expect(onCreateAt).toHaveBeenCalledTimes(1)
    // 반복 막음은 Enter·Space 만 — 방향키 길게 누르기(이동)는 그대로여야 한다.
    fireEvent.keyDown(cell, { key: 'ArrowRight', repeat: true })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight', repeat: true })
    expect(document.activeElement).toHaveAccessibleName('2026년 11월 23일 월요일')
    expect(zeroTabCells()).toHaveLength(1)
  })

  it('칸 안 칩에 초점이 가도 그 칸이 로빙 초점 칸이 된다(리뷰 후속 1 — click 이 오지 않는 자손 초점)', () => {
    renderWithProviders(
      <MonthView
        events={[calendarEvent({ id: 1, title: '회의', startsAt: '2026-11-05T01:00:00Z', endsAt: '2026-11-05T02:00:00Z' })]}
        issueDues={[]}
        anchor={new Date(2026, 10, 1)}
        onCreateAt={vi.fn()}
        onSelectEvent={vi.fn()}
        onSelectIssue={vi.fn()}
      />,
    )
    // 기본 로빙 칸은 오늘(21일) — 5일 칸 안 칩에 초점을 주면 그 칸으로 로빙이 따라가야 한다(onFocus 는 focusin 으로 번진다).
    const chip = screen.getByRole('button', { name: /회의/ })
    act(() => chip.focus())
    const cell = screen.getByRole('gridcell', { name: '2026년 11월 5일 목요일' })
    expect(cell.tabIndex).toBe(0)
    expect(zeroTabCells()).toHaveLength(1)
    expect(document.activeElement).toBe(chip)
  })

  it('칸 안 요약 사본은 aria-hidden — 설명은 aria-describedby 로만 읽는다(리뷰 후속 4)', () => {
    const events = [calendarEvent({ id: 1, title: '회의', startsAt: '2026-11-21T01:00:00Z', endsAt: '2026-11-21T02:00:00Z' })]
    renderWithProviders(
      <MonthView events={events} issueDues={[]} anchor={new Date(2026, 10, 1)} onCreateAt={vi.fn()} onSelectEvent={vi.fn()} onSelectIssue={vi.fn()} />,
    )
    const cell = screen.getByRole('gridcell', { name: TODAY_NAME })
    expect(cell).toHaveAccessibleDescription('일정 1개')
    expect(cell.querySelector('.sr-only')).toHaveAttribute('aria-hidden', 'true')
  })
})


// 스텁 ResizeObserver 가 받은 콜백 — 테스트가 직접 불러 창 크기 바뀜을 흉내 낸다.
let roCallbacks: Array<() => void> = []
// 그리드 높이(px) — 0 이면 측정 못 한 상태
let gridHeight = 600

/** 로컬 시각 기준 일정 팩토리 */
function ev(id: number, start: Date, end: Date): CalendarEvent {
  return calendarEvent({ id, title: `일정${id}`, startsAt: start.toISOString(), endsAt: end.toISOString(), allDay: false })
}

const anchor = new Date(2026, 4, 15)

function renderMonth(events: CalendarEvent[]) {
  return render(
    <MonthView
      events={events}
      issueDues={[]}
      anchor={anchor}
      onSelectEvent={vi.fn()}
      onSelectIssue={vi.fn()}
      onCreateAt={vi.fn()}
      onMoveEvent={vi.fn()}
      canMoveEvent={() => false}
    />,
  )
}

// 5월 20일 하루에 일정 5개
const five = [1, 2, 3, 4, 5].map((i) => ev(i, new Date(2026, 4, 20, 9 + i), new Date(2026, 4, 20, 10 + i)))
const chipCount = () => screen.getByTestId('calendar-cell-2026-05-20').querySelectorAll('[data-testid^="calendar-event-"]').length

describe('MonthView 렌더 비용', () => {
  beforeEach(() => {
    resetMonthRowHeightForTest()
    roCallbacks = []
    gridHeight = 600
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => gridHeight)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          roCallbacks.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('다시 열면 처음 렌더부터 잰 행 높이로 칩 수를 정한다', () => {
    const first = renderMonth(five)
    // 행 100 → 2개 + 「+3」
    expect(chipCount()).toBe(2)
    expect(screen.getByTestId('calendar-more-2026-05-20').textContent).toBe('+3')
    first.unmount()

    // 두 번째는 잴 수 없어도(0) 기억한 높이로 그린다 — 측정 전 기본 3개가 아니다
    gridHeight = 0
    renderMonth(five)
    expect(chipCount()).toBe(2)
    expect(screen.getByTestId('calendar-more-2026-05-20').textContent).toBe('+3')
    // Profiler 렌더 수 단언은 없다 — Radix 팝오버 때문에 MonthView 와 무관하게 2회가 되며, 위 칩 수가 기억한 높이 사용을 증명한다.
  })

  it('창 크기가 바뀌면 다시 재어 반영한다', () => {
    renderMonth(five)
    expect(chipCount()).toBe(2)
    gridHeight = 1200
    act(() => roCallbacks.forEach((cb) => cb()))
    expect(chipCount()).toBe(5)
    expect(screen.queryByTestId('calendar-more-2026-05-20')).toBeNull()
  })

  it('칸마다 일정은 eventsOnDay 와 같다', () => {
    // 5/12 10시 ~ 5/13 11시 — 두 칸에 걸친다
    renderMonth([ev(9, new Date(2026, 4, 12, 10), new Date(2026, 4, 13, 11))])
    expect(screen.getByTestId('calendar-cell-2026-05-12').querySelector('[data-testid="calendar-event-9"]')).not.toBeNull()
    expect(screen.getByTestId('calendar-cell-2026-05-13').querySelector('[data-testid="calendar-event-9"]')).not.toBeNull()
    expect(screen.getByTestId('calendar-cell-2026-05-14').querySelector('[data-testid="calendar-event-9"]')).toBeNull()
  })
})
