import { useQuery } from '@tanstack/react-query'

import { calendarApi } from '../../api/calendar'
import type { CalendarEvent } from '../../types/calendar'

// #460: 단일 일정 상세 — show_event 위젯용. eventId 없으면 비활성(상세 위젯 ID 누락 가드).
export function useCalendarEvent(eventId?: number) {
  return useQuery<CalendarEvent>({
    queryKey: ['calendar', 'event', eventId],
    queryFn: () => calendarApi.get(eventId as number).then((r) => r.data),
    enabled: typeof eventId === 'number' && Number.isFinite(eventId),
    retry: false,
  })
}
