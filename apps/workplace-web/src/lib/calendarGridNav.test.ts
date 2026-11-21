import { describe, expect, it } from 'vitest'

import { monthMatrix } from '@/lib/calendar'

import { calendarDayLabel, dayColumnLabel, defaultMonthFocusIndex, defaultTimeSlot, nextMonthCellIndex, nextTimeSlot, timeSlotLabel } from './calendarGridNav'

describe('nextMonthCellIndex', () => {
  it.each([
    [10, 'ArrowRight', 11],
    [10, 'ArrowLeft', 9],
    [10, 'ArrowDown', 17],
    [10, 'ArrowUp', 3],
    [10, 'Home', 7],
    [10, 'End', 13],
    [0, 'ArrowLeft', 0],
    [3, 'ArrowUp', 3],
    [41, 'ArrowRight', 41],
    [38, 'ArrowDown', 38],
  ])('index %i + %s → %i', (index, key, expected) => {
    expect(nextMonthCellIndex(index, key)).toBe(expected)
  })
  it('이동 키가 아니면 null', () => {
    expect(nextMonthCellIndex(10, 'a')).toBeNull()
  })
})

describe('calendarDayLabel', () => {
  it('날짜 이름, 오늘이면 「, 오늘」 을 붙인다', () => {
    expect(calendarDayLabel(new Date(2026, 10, 21), false)).toBe('2026년 11월 21일 토요일')
    expect(calendarDayLabel(new Date(2026, 10, 21), true)).toBe('2026년 11월 21일 토요일, 오늘')
  })
})

describe('defaultMonthFocusIndex', () => {
  const cells = monthMatrix(new Date(2026, 10, 1))
  const indexOf = (d: Date) => cells.findIndex((c) => c.getTime() === d.getTime())
  it('오늘이 보이면 오늘 칸', () => {
    expect(defaultMonthFocusIndex(cells, new Date(2026, 10, 1), new Date(2026, 10, 21))).toBe(indexOf(new Date(2026, 10, 21)))
  })
  it('오늘이 안 보이면 그달 1일 칸', () => {
    expect(defaultMonthFocusIndex(cells, new Date(2026, 10, 1), new Date(2026, 11, 25))).toBe(indexOf(new Date(2026, 10, 1)))
  })
})

describe('nextTimeSlot', () => {
  it('방향키·Home/End 로 이동한다', () => {
    expect(nextTimeSlot({ dayIndex: 2, hour: 9 }, 'ArrowUp', 7)).toEqual({ dayIndex: 2, hour: 8 })
    expect(nextTimeSlot({ dayIndex: 2, hour: 9 }, 'ArrowDown', 7)).toEqual({ dayIndex: 2, hour: 10 })
    expect(nextTimeSlot({ dayIndex: 2, hour: 9 }, 'ArrowLeft', 7)).toEqual({ dayIndex: 1, hour: 9 })
    expect(nextTimeSlot({ dayIndex: 2, hour: 9 }, 'ArrowRight', 7)).toEqual({ dayIndex: 3, hour: 9 })
    expect(nextTimeSlot({ dayIndex: 2, hour: 9 }, 'Home', 7)).toEqual({ dayIndex: 2, hour: 0 })
    expect(nextTimeSlot({ dayIndex: 2, hour: 9 }, 'End', 7)).toEqual({ dayIndex: 2, hour: 23 })
  })
  it('끝에서는 멈춘다', () => {
    expect(nextTimeSlot({ dayIndex: 0, hour: 0 }, 'ArrowUp', 7)).toEqual({ dayIndex: 0, hour: 0 })
    expect(nextTimeSlot({ dayIndex: 0, hour: 0 }, 'ArrowLeft', 7)).toEqual({ dayIndex: 0, hour: 0 })
    expect(nextTimeSlot({ dayIndex: 6, hour: 23 }, 'ArrowDown', 7)).toEqual({ dayIndex: 6, hour: 23 })
    expect(nextTimeSlot({ dayIndex: 6, hour: 23 }, 'ArrowRight', 7)).toEqual({ dayIndex: 6, hour: 23 })
    expect(nextTimeSlot({ dayIndex: 0, hour: 5 }, 'ArrowRight', 1)).toEqual({ dayIndex: 0, hour: 5 })
  })
  it('이동 키가 아니면 null', () => {
    expect(nextTimeSlot({ dayIndex: 0, hour: 0 }, 'x', 7)).toBeNull()
  })
})

describe('timeSlotLabel · dayColumnLabel', () => {
  it('시간 칸 이름', () => {
    expect(timeSlotLabel(dayColumnLabel(new Date(2026, 10, 21)), 9)).toBe('11월 21일 토요일 오전 9시 새 일정')
    expect(timeSlotLabel(dayColumnLabel(new Date(2026, 10, 21)), 0)).toBe('11월 21일 토요일 오전 12시 새 일정')
    expect(timeSlotLabel(dayColumnLabel(new Date(2026, 10, 21)), 13)).toBe('11월 21일 토요일 오후 1시 새 일정')
  })
  it('날짜 열 이름', () => {
    expect(dayColumnLabel(new Date(2026, 10, 21))).toBe('11월 21일 토요일')
  })
})

describe('defaultTimeSlot', () => {
  const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 15 + i))
  it('오늘 열이면 지금 시', () => {
    expect(defaultTimeSlot(days, new Date(2026, 10, 21, 10, 30))).toEqual({ dayIndex: 6, hour: 10 })
  })
  it('오늘이 없으면 첫 열 8시', () => {
    expect(defaultTimeSlot(days, new Date(2026, 11, 25, 10))).toEqual({ dayIndex: 0, hour: 8 })
  })
})
