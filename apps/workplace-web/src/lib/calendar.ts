import {
  addDays, eachDayOfInterval, endOfDay, endOfMonth,
  startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'
import type { CalendarEvent, CalendarViewType } from '../types/calendar'

// 월 그리드: 해당 월을 포함하는 일요일 시작 6주(42칸).
export function monthMatrix(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 })
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

// 해당 주(일요일 시작) 7일.
export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor, { weekStartsOn: 0 })
  return eachDayOfInterval({ start: first, end: addDays(first, 6) })
}

// 뷰별 서버 조회 범위(ISO). 겹침 쿼리에 사용.
export function visibleRange(view: CalendarViewType, anchor: Date): { from: string; to: string } {
  let start: Date
  let end: Date
  if (view === 'month') {
    start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 })
    end = addDays(start, 42)
  } else if (view === 'week' || view === 'agenda') {
    start = startOfWeek(anchor, { weekStartsOn: 0 })
    end = view === 'agenda' ? addDays(start, 30) : addDays(start, 7)
  } else {
    start = startOfDay(anchor)
    end = addDays(start, 1)
  }
  return { from: start.toISOString(), to: end.toISOString() }
}

// 특정 날짜와 겹치는 일정.
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)
  return events.filter((e) => {
    const s = new Date(e.startsAt)
    const en = new Date(e.endsAt)
    return s <= dayEnd && en > dayStart
  })
}

// 시간축(0~23시) 슬롯.
export const HOURS = Array.from({ length: 24 }, (_, h) => h)

// 시:분 표기.
export function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export { startOfMonth, endOfMonth, addDays }
