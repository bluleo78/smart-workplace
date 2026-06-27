import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { calendarsApi } from '@/api/calendars'
import type { Calendar, CalendarRequest } from '@/types/calendar'

import { calendarKeys } from './calendarKeys'

// 내 캘린더 목록.
export function useCalendars() {
  return useQuery<Calendar[]>({
    queryKey: calendarKeys.calendars,
    queryFn: () => calendarsApi.list().then((r) => r.data),
    staleTime: 30_000,
  })
}

// 캘린더 생성/수정/삭제 — 성공 시 목록+일정 무효화(색 변경이 일정 렌더에 반영되도록).
export function useCreateCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarRequest) => calendarsApi.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}

export function useUpdateCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; body: CalendarRequest }) =>
      calendarsApi.update(v.id, v.body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}

export function useDeleteCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}
