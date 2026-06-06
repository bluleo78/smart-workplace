// 캘린더 일정 생성/수정/삭제 mutation. 성공 시 calendarKeys.all 무효화(목록 갱신).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calendarApi } from '../../api/calendar'
import { handleApiError } from '../../lib/api-error'
import type { CalendarEventRequest } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

export function useCreateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarEventRequest) =>
      calendarApi.create(body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      toast.success('일정을 추가했습니다')
    },
    onError: (e) => handleApiError(e, '일정 추가에 실패했습니다'),
  })
}

export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: CalendarEventRequest }) =>
      calendarApi.update(id, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      toast.success('일정을 수정했습니다')
    },
    onError: (e) => handleApiError(e, '일정 수정에 실패했습니다'),
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarApi.remove(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      toast.success('일정을 삭제했습니다')
    },
    onError: (e) => handleApiError(e, '일정 삭제에 실패했습니다'),
  })
}
