import { useQuery } from '@tanstack/react-query'

import { calendarApi } from '../../api/calendar'
import type { CalendarEvent } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

// 가시 범위의 일정 조회.
export function useCalendarEvents(from: string, to: string, options?: { enabled?: boolean }) {
  return useQuery<CalendarEvent[]>({
    queryKey: calendarKeys.range(from, to),
    queryFn: () => calendarApi.list(from, to).then((r) => r.data),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}

// 단건 일정 조회 — 알림 딥링크(?eventId=)로 특정 일정 상세를 열 때 사용 (#659).
// id 가 null 이면 비활성화. 삭제됐거나 접근 권한 없는 일정은 404/403 → 폴백 처리는 호출부(CalendarPage) 책임.
export function useCalendarEvent(id: number | null) {
  return useQuery<CalendarEvent>({
    queryKey: id != null ? calendarKeys.event(id) : ['calendar', 'events', 'none'],
    queryFn: () => calendarApi.get(id as number).then((r) => r.data),
    enabled: id != null,
    retry: false,
  })
}
