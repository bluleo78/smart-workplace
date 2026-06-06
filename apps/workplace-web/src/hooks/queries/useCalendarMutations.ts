// 캘린더 일정 생성/수정/삭제 mutation. 성공 시 calendarKeys.all 무효화(목록 갱신).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calendarApi, type ScopeParams } from '../../api/calendar'
import { handleApiError } from '../../lib/api-error'
import type { CalendarEventRequest, EditScope } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

// scope/occurrenceDate 를 쿼리 파라미터로 정리 — 값이 있을 때만 포함(반복 일정에서만 전달).
// occurrenceDate 는 서버가 준 불투명 문자열을 그대로 echo.
function scopeParams(scope?: EditScope, occurrenceDate?: string | null): ScopeParams | undefined {
  const params: ScopeParams = {}
  if (scope) params.scope = scope
  if (occurrenceDate) params.occurrenceDate = occurrenceDate
  return Object.keys(params).length ? params : undefined
}

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
    // scope/occurrenceDate 미지정 시 단일 일정 수정(서버 기본 scope=ALL).
    mutationFn: ({
      id,
      body,
      scope,
      occurrenceDate,
    }: {
      id: number
      body: CalendarEventRequest
      scope?: EditScope
      occurrenceDate?: string | null
    }) => calendarApi.update(id, body, scopeParams(scope, occurrenceDate)).then((r) => r.data),
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
    // scope/occurrenceDate 미지정 시 단일 일정 삭제(서버 기본 scope=ALL).
    mutationFn: ({
      id,
      scope,
      occurrenceDate,
    }: {
      id: number
      scope?: EditScope
      occurrenceDate?: string | null
    }) => calendarApi.remove(id, scopeParams(scope, occurrenceDate)).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      toast.success('일정을 삭제했습니다')
    },
    onError: (e) => handleApiError(e, '일정 삭제에 실패했습니다'),
  })
}
