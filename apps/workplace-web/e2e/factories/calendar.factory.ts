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
    recurrenceRule: null,
    createdAt: '2026-06-10T01:00:00Z',
    updatedAt: '2026-06-10T01:00:00Z',
    ...over,
  }
}

// 반복 일정의 가상 occurrence 목록을 만든다 (이슈 #111, Task 9 E2E 용).
// occurrenceDates 각 항목마다 한 건씩: id/masterEventId 는 masterId 공통,
// startsAt·occurrenceDate 는 해당 날짜, endsAt 는 시작 +1시간.
export function recurringCalendarEvent(
  masterId: number,
  occurrenceDates: string[],
  over: Partial<CalendarEvent> = {},
): CalendarEvent[] {
  const rule = over.recurrenceRule ?? 'FREQ=WEEKLY'
  return occurrenceDates.map((date) =>
    calendarEvent({
      id: masterId,
      masterEventId: masterId,
      recurrenceRule: rule,
      startsAt: date,
      occurrenceDate: date,
      // 시작 +1시간 종료
      endsAt: new Date(new Date(date).getTime() + 60 * 60 * 1000).toISOString(),
      ...over,
    }),
  )
}
