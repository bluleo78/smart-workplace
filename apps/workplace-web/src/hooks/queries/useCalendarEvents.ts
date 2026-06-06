import { useQuery } from '@tanstack/react-query'

import { calendarApi } from '../../api/calendar'
import type { CalendarEvent } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

// 가시 범위의 일정 조회.
export function useCalendarEvents(from: string, to: string) {
  return useQuery<CalendarEvent[]>({
    queryKey: calendarKeys.range(from, to),
    queryFn: () => calendarApi.list(from, to).then((r) => r.data),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })
}
