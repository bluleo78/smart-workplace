import { describe, expect, it } from 'vitest'

import type { CalendarEvent } from '../types/calendar'
import { eventsOnDay,monthMatrix, visibleRange, weekDays } from './calendar'

const ev = (id: number, startsAt: string, endsAt: string, allDay = false): CalendarEvent => ({
  id, title: `e${id}`, description: null, startsAt, endsAt, allDay,
  location: null, color: null, calendarId: 1, calendarName: '기본', effectiveColor: 'blue',
  reminderMinutes: null, recurrenceRule: null, createdAt: startsAt, updatedAt: startsAt,
})

describe('monthMatrix', () => {
  it('일요일 시작 6주(42칸) 그리드를 만든다', () => {
    const cells = monthMatrix(new Date('2026-06-15T00:00:00'))
    expect(cells).toHaveLength(42)
    expect(cells[0].getDay()).toBe(0)
  })
})

describe('weekDays', () => {
  it('해당 주의 7일을 일요일부터 반환', () => {
    const days = weekDays(new Date('2026-06-10T00:00:00'))
    expect(days).toHaveLength(7)
    expect(days[0].getDay()).toBe(0)
  })
})

describe('visibleRange', () => {
  it('month 뷰는 from<to ISO 범위', () => {
    const { from, to } = visibleRange('month', new Date('2026-06-15T00:00:00'))
    expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime())
  })
})

describe('eventsOnDay', () => {
  it('해당 날짜와 겹치는 일정만 반환', () => {
    const list = [ev(1, '2026-06-10T09:00:00Z', '2026-06-10T10:00:00Z'),
                  ev(2, '2026-06-11T09:00:00Z', '2026-06-11T10:00:00Z')]
    const got = eventsOnDay(list, new Date('2026-06-10T00:00:00'))
    expect(got.map((e) => e.id)).toEqual([1])
  })
})
