import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calendarsApi } from '@/api/calendars'
import { handleApiError } from '@/lib/api-error'
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

/**
 * 캘린더 삭제 — 서버가 소속 일정을 기본 캘린더로 옮기므로(CalendarService) 성공 안내에 그 결과를 함께 알린다.
 * 실패는 오류 토스트로 알린다(WP-1140 — 전에는 결과도 실패도 화면에 드러나지 않았다).
 */
export function useDeleteCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      toast.success('캘린더를 삭제했습니다. 일정은 기본 캘린더로 옮겼습니다')
    },
    onError: (e) => handleApiError(e, '캘린더 삭제에 실패했습니다'),
  })
}

/** 캘린더 강제 리셋(모든 일정 삭제) — 성공 시 일정/캘린더 캐시 무효화. */
export function useResetCalendarEvents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarsApi.resetEvents(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}
