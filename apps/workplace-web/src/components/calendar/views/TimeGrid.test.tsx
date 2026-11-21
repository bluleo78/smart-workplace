// TimeGrid 접근성 테스트(WP-1906) — 날짜 열 이름·시간 칸 이름·로빙 tabIndex·키보드 조작.
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOUR_SLOT_PX } from '@/lib/calendar'
import { renderWithProviders } from '@/test/renderWithProviders'

import { calendarEvent } from '../../../../e2e/factories/calendar.factory'
import { TimeGrid } from './TimeGrid'

const SLOT = /새 일정$/
const TODAY_10 = '11월 21일 토요일 10:00 새 일정'

const weekOf = (startDay: number) => Array.from({ length: 7 }, (_, i) => new Date(2026, 10, startDay + i))

function setup(withEvent = false) {
  const onCreateAt = vi.fn()
  const props = {
    // 2026-11-21 10:00~11:00 (KST) 타임드 일정 — 칸 위에 얹히는 블록 버튼
    events: withEvent ? [calendarEvent({ id: 1, title: '회의', startsAt: '2026-11-21T01:00:00Z', endsAt: '2026-11-21T02:00:00Z' })] : [],
    issueDues: [],
    anchor: new Date(2026, 10, 21),
    onCreateAt,
    onSelectEvent: vi.fn(),
    onSelectIssue: vi.fn(),
    testid: 'calendar-view-week',
  }
  const view = renderWithProviders(<TimeGrid {...props} days={weekOf(15)} />)
  const rerenderDays = (days: Date[]) => view.rerender(<TimeGrid {...props} days={days} />)
  return { onCreateAt, rerenderDays }
}

const slots = () => screen.getAllByRole('button', { name: SLOT })
const zeroTabSlots = () => slots().filter((c) => c.tabIndex === 0)

describe('TimeGrid 접근성', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 21, 10))
  })
  afterEach(() => vi.useRealTimers())

  it('날짜 열·종일 칸이 group 이름을 가진다', () => {
    setup()
    expect(screen.getAllByRole('group', { name: /^11월 \d+일 .요일$/ })).toHaveLength(7)
    expect(screen.getByRole('group', { name: '11월 21일 토요일 종일' })).toBeInTheDocument()
  })

  it('시간 칸 168개, tabIndex 0 은 오늘 10시 하나', () => {
    setup()
    expect(slots()).toHaveLength(168)
    expect(zeroTabSlots()).toHaveLength(1)
    expect(zeroTabSlots()[0]).toHaveAccessibleName(TODAY_10)
  })

  it('방향키로 초점이 옮겨 가고 tabIndex 0 은 그 칸 하나', async () => {
    const user = userEvent.setup()
    setup()
    screen.getByRole('button', { name: TODAY_10 }).focus()
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toHaveAccessibleName('11월 21일 토요일 09:00 새 일정')
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toHaveAccessibleName('11월 20일 금요일 09:00 새 일정')
    expect(zeroTabSlots()).toHaveLength(1)
    expect(zeroTabSlots()[0]).toBe(document.activeElement)
  })

  it('Enter·Space 는 그 칸 정각으로 onCreateAt(끝 인자 없음), Space 는 기본 동작을 막는다', async () => {
    const user = userEvent.setup()
    const { onCreateAt } = setup()
    screen.getByRole('button', { name: TODAY_10 }).focus()
    await user.keyboard('{ArrowUp}{ArrowLeft}{Enter}')
    expect(onCreateAt).toHaveBeenCalledTimes(1)
    const [start, end] = onCreateAt.mock.calls[0]
    expect(start.getDate()).toBe(20)
    expect(start.getHours()).toBe(9)
    expect(start.getMinutes()).toBe(0)
    expect(end).toBeUndefined()
    await user.keyboard(' ')
    expect(onCreateAt).toHaveBeenCalledTimes(2)
    const cell = document.activeElement as HTMLElement
    expect(fireEvent.keyDown(cell, { key: ' ' })).toBe(false)
  })

  it('Alt·Ctrl·Meta 와 함께 누른 키는 가로채지 않는다', () => {
    setup()
    const cell = screen.getByRole('button', { name: TODAY_10 })
    cell.focus()
    expect(fireEvent.keyDown(cell, { key: 'ArrowRight', altKey: true })).toBe(true)
    expect(document.activeElement).toBe(cell)
  })

  it('일정 블록 버튼의 Enter·방향키는 칸의 새 일정·이동을 일으키지 않는다', () => {
    const { onCreateAt } = setup(true)
    const block = screen.getByRole('button', { name: /회의/ })
    block.focus()
    fireEvent.keyDown(block, { key: 'Enter' })
    fireEvent.keyDown(block, { key: 'ArrowDown' })
    expect(onCreateAt).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(block)
  })

  it('날짜가 바뀌어 오늘이 없으면 첫 열 오전 8시가 유일한 Tab 정지점', () => {
    const { rerenderDays } = setup()
    rerenderDays(weekOf(22))
    expect(zeroTabSlots()).toHaveLength(1)
    expect(zeroTabSlots()[0]).toHaveAccessibleName('11월 22일 일요일 08:00 새 일정')
  })

  it('칸을 클릭하면 정각으로 열리고 그 칸이 초점 칸이 된다', async () => {
    const user = userEvent.setup()
    const { onCreateAt } = setup()
    const cell = screen.getByRole('button', { name: '11월 18일 수요일 15:00 새 일정' })
    await user.click(cell)
    expect(onCreateAt).toHaveBeenCalledTimes(1)
    expect(onCreateAt.mock.calls[0][0].getHours()).toBe(15)
    expect(cell.tabIndex).toBe(0)
    expect(zeroTabSlots()).toHaveLength(1)
  })

  it('마우스로 누른 칸에서 키를 쓰면 초점 링이 켜진다 — 클릭 초점에는 링이 없다가 키보드로 넘어오면 보인다', async () => {
    setup()
    const cell = screen.getByRole('button', { name: '11월 18일 수요일 15:00 새 일정' })
    // 마우스 클릭과 같은 초점 — jsdom 은 프로그램 초점도 :focus-visible 로 보므로 그 판정을 「아님」으로 바꿔 흉내 낸다.
    vi.spyOn(cell, 'matches').mockReturnValue(false)
    act(() => cell.focus())
    fireEvent.click(cell)
    expect(screen.queryByTestId('calendar-slot-focus-ring')).not.toBeInTheDocument()
    // 같은 칸에서 Enter — 초점은 그대로라 focus 이벤트 없이 키 입력만으로 링이 켜져야 한다.
    fireEvent.keyDown(cell, { key: 'Enter' })
    const ring = screen.getByTestId('calendar-slot-focus-ring')
    expect(ring.style.top).toBe(`${15 * HOUR_SLOT_PX}px`)
  })

  it('키보드로 칸에 초점이 가면 그 열에 초점 링 오버레이가 그 시각 위치로 뜨고, blur 뒤 사라진다', async () => {
    const user = userEvent.setup()
    setup(true)
    expect(screen.queryByTestId('calendar-slot-focus-ring')).not.toBeInTheDocument()
    // Tab 으로 들어가 키보드 초점(:focus-visible)이 되게 한다 — 로빙 정지점은 오늘 10시 칸.
    await user.tab()
    // 헤더·종일 칸의 버튼이 먼저 잡힐 수 있어 칸에 닿을 때까지 이동한다.
    for (let i = 0; i < 5 && document.activeElement?.getAttribute('aria-label') !== TODAY_10; i++) await user.tab()
    expect(document.activeElement).toHaveAccessibleName(TODAY_10)
    const ring = screen.getByTestId('calendar-slot-focus-ring')
    expect(ring.style.top).toBe(`${10 * HOUR_SLOT_PX}px`)
    expect(ring.closest('[data-testid="calendar-day-column"]')).toHaveAccessibleName('11월 21일 토요일')
    act(() => (document.activeElement as HTMLElement).blur())
    expect(screen.queryByTestId('calendar-slot-focus-ring')).not.toBeInTheDocument()
  })

  it('초점이 tabIndex=-1 칸에도 가면 그 칸이 로빙 초점 칸이 된다(리뷰 후속 1)', () => {
    setup()
    const cell = screen.getByRole('button', { name: '11월 18일 수요일 15:00 새 일정' })
    expect(cell.tabIndex).toBe(-1)
    act(() => cell.focus())
    expect(cell.tabIndex).toBe(0)
    expect(zeroTabSlots()).toHaveLength(1)
    expect(zeroTabSlots()[0]).toBe(cell)
    // 초점 링도 그 칸의 시각 위치로 따라간다 — 로빙 표식과 실제 초점이 어긋나지 않게.
    const ring = screen.getByTestId('calendar-slot-focus-ring')
    expect(ring.style.top).toBe(`${15 * HOUR_SLOT_PX}px`)
  })

  it('Enter 을 길게 누르면(ev.repeat) 한 번만 연다(리뷰 후속 3)', () => {
    const { onCreateAt } = setup()
    const cell = screen.getByRole('button', { name: TODAY_10 })
    cell.focus()
    fireEvent.keyDown(cell, { key: 'Enter' })
    fireEvent.keyDown(cell, { key: 'Enter', repeat: true })
    fireEvent.keyDown(cell, { key: 'Enter', repeat: true })
    expect(onCreateAt).toHaveBeenCalledTimes(1)
    // 반복 막음은 Enter·Space 만 — 방향키 길게 누르기(시간 이동)는 그대로여야 한다.
    fireEvent.keyDown(cell, { key: 'ArrowUp', repeat: true })
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp', repeat: true })
    expect(document.activeElement).toHaveAccessibleName('11월 21일 토요일 08:00 새 일정')
    expect(zeroTabSlots()).toHaveLength(1)
  })

  it('시각이 흘러도 Tab 정지점이 다른 칸으로 옮겨가지 않는다(리뷰 후속 2)', () => {
    const { rerenderDays } = setup()
    expect(zeroTabSlots()[0]).toHaveAccessibleName(TODAY_10)
    // 같은 날 안에서 시각이 한 시간 넘게 흘러도 기본 초점 칸은 그대로여야 한다(새 Date() 를 쓰면 11시로 옮겨 간다).
    vi.setSystemTime(new Date(2026, 10, 21, 11, 30))
    rerenderDays(weekOf(15))
    expect(zeroTabSlots()).toHaveLength(1)
    expect(zeroTabSlots()[0]).toHaveAccessibleName(TODAY_10)
  })
})
