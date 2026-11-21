// MonthView 접근성 테스트(WP-1906) — grid 구조·날짜 칸 이름·로빙 tabIndex·키보드 조작.
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isSameDay } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { IssueDueMarker } from '@/types/calendar'

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
})
