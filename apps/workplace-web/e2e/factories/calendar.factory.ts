// 캘린더 E2E 팩토리 — 일정 응답 모킹용.
import type { CalendarEvent } from '../../src/types/calendar'

export function calendarEvent(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 1,
    title: '팀 회의',
    description: null,
    startsAt: '2026-06-10T01:00:00Z',
    endsAt: '2026-06-10T02:00:00Z',
    allDay: false,
    location: null,
    color: null,
    reminderMinutes: null,
    createdAt: '2026-06-10T01:00:00Z',
    updatedAt: '2026-06-10T01:00:00Z',
    ...over,
  }
}
