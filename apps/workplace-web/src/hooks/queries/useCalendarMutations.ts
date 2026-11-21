// 캘린더 일정 생성/수정/삭제 mutation. 성공 시 calendarKeys.all 무효화(목록 갱신).
import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calendarApi, type ScopeParams } from '../../api/calendar'
import { extractApiError, handleApiError } from '../../lib/api-error'
import { isEventConflict } from '../../lib/eventConflict'
import type { CalendarEvent, CalendarEventRequest, EditScope, RsvpStatus } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

// scope/occurrenceDate 를 쿼리 파라미터로 정리 — 값이 있을 때만 포함(반복 일정에서만 전달).
// occurrenceDate 는 서버가 준 불투명 문자열을 그대로 echo.
// expectedUpdatedAt 은 수정 충돌 감지용(WP-1920) — 있을 때만 싣는다.
function scopeParams(
  scope?: EditScope,
  occurrenceDate?: string | null,
  expectedUpdatedAt?: string,
): ScopeParams | undefined {
  const params: ScopeParams = {}
  if (scope) params.scope = scope
  if (occurrenceDate) params.occurrenceDate = occurrenceDate
  if (expectedUpdatedAt) params.expectedUpdatedAt = expectedUpdatedAt
  return Object.keys(params).length ? params : undefined
}

/**
 * 수정 응답의 새 updatedAt 을 캐시된 일정(범위 목록·상세)에 반영한다.
 * - 응답과 id 가 같은 항목만 반영한다. 가상 회차도 id 가 마스터 id 와 같아서(masterEventId 는 따로 가진다) 마스터를 고친 응답(scope 없음·ALL)은
 *   같은 id 비교로 가상 회차까지 함께 갱신된다.
 * - THIS·THIS_AND_FOLLOWING 의 응답은 예외 행·새 시리즈(다른 id)일 수 있어, 응답 id 와 같은 행만 고치면 다른 행의 버전을 잘못 덮을 일이 없다.
 *   나머지는 이어지는 재조회에 맡긴다.
 */
export function applyFreshVersion(qc: QueryClient, updated: CalendarEvent | undefined) {
  if (!updated?.id || !updated.updatedAt) return
  const patch = (e: CalendarEvent): CalendarEvent =>
    e.id === updated.id ? { ...e, updatedAt: updated.updatedAt } : e
  // 바뀐 항목이 없으면 원래 data 를 그대로 돌려준다 — 새 참조를 만들면 구독 중인 화면이 쓸데없이 다시 그려진다.
  const patchData = (data: unknown) => {
    if (Array.isArray(data)) {
      const next = data.map((e) => (e && typeof e === 'object' && 'id' in e ? patch(e as CalendarEvent) : e))
      return next.some((e, i) => e !== data[i]) ? next : data
    }
    if (data && typeof data === 'object' && 'id' in data && 'updatedAt' in data) return patch(data as CalendarEvent)
    return data
  }
  // calendarKeys.all 한 번으로 묶지 않는다 — 그 아래에는 캘린더 목록·태그처럼 id 가 겹칠 수 있는 다른 데이터도 있어
  // 엉뚱한 항목의 updatedAt 을 덮을 수 있다. 일정 목록·상세 두 접두만 고친다.
  qc.setQueriesData({ queryKey: calendarKeys.events }, patchData)
  qc.setQueriesData({ queryKey: calendarKeys.eventDetails }, patchData)
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
      expectedUpdatedAt,
    }: {
      id: number
      body: CalendarEventRequest
      scope?: EditScope
      occurrenceDate?: string | null
      // 연 때 본 일정의 updatedAt — 그 사이 다른 사람이 고쳤으면 서버가 409 로 막는다.
      expectedUpdatedAt?: string
    }) =>
      calendarApi.update(id, body, scopeParams(scope, occurrenceDate, expectedUpdatedAt)).then((r) => r.data),
    onSuccess: (updated) => {
      // 재조회가 끝나기 전에 같은 일정을 또 저장하면 낡은 updatedAt 을 보내 자기 변경과 충돌(409)한다 —
      // 응답의 새 updatedAt 을 캐시에 먼저 써 둔다(WP-1920). 무효화는 그대로 두어 나머지 필드는 재조회로 맞춘다.
      applyFreshVersion(qc, updated)
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      toast.success('일정을 수정했습니다')
    },
    onError: (e) => {
      // 다른 사람이 먼저 고친 충돌 — 서버 안내를 보이고 목록을 다시 받아 최신 내용을 보게 한다(WP-1920).
      if (isEventConflict(e)) {
        toast.error(extractApiError(e, '다른 사람이 먼저 이 일정을 수정했습니다'))
        qc.invalidateQueries({ queryKey: calendarKeys.all })
        return
      }
      handleApiError(e, '일정 수정에 실패했습니다')
    },
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

// ────────────────────────────────────────────────────────────
// 참석자 관련 mutation 훅 (이슈 #489)
// ────────────────────────────────────────────────────────────

/** 참석자 초대 — 성공 시 캘린더 캐시 무효화 */
export function useInviteAttendees(eventId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userIds: number[]) =>
      calendarApi.invite(eventId, userIds).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      qc.invalidateQueries({ queryKey: ['calendar', 'event', eventId] })
    },
    onError: (e) => handleApiError(e, '참석자 초대에 실패했습니다'),
  })
}

/** 참석자 제거 — 성공 시 캘린더 캐시 무효화 */
export function useRemoveAttendee(eventId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: number) =>
      calendarApi.removeAttendee(eventId, userId).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      qc.invalidateQueries({ queryKey: ['calendar', 'event', eventId] })
    },
    onError: (e) => handleApiError(e, '참석자 제거에 실패했습니다'),
  })
}

/** 내 RSVP 응답 — 성공 시 캘린더 캐시 무효화 */
export function useRsvp(eventId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (status: RsvpStatus) =>
      calendarApi.rsvp(eventId, status).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      qc.invalidateQueries({ queryKey: ['calendar', 'event', eventId] })
      toast.success('참석 여부를 업데이트했습니다')
    },
    onError: (e) => handleApiError(e, 'RSVP 업데이트에 실패했습니다'),
  })
}
