// 일정(회차)의 회의록 노트 조회·잇기·끊기(WP-1701).
// 조회는 전용 GET — 상세 GET 은 반복이면 마스터를 돌려줘 회차 키가 없다. 잇기·끊기 응답은 setQueryData 로 바로 카드에 반영한다.
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { calendarApi } from '../../api/calendar'
import { handleApiError } from '../../lib/api-error'
import type { EventNoteLink } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

/**
 * 잇기·끊기 뒤 노트 하단 「연결된 일정」(noteEvents) 을 다시 읽게 한다(WP-1703) — 그대로 두면 노트로 돌아왔을 때 30초(staleTime)
 * 동안 옛 줄이 남거나 새 줄이 빠진다. 다른 노트로 바꿔 잇거나 끊으면 이전 노트도 바뀌는데 그 id 는 캐시로만 알 수 있어, 접두로 모두 무효화한다
 * (react-query 는 화면에 붙은 쿼리만 다시 읽으므로 비용은 같다).
 */
function invalidateNoteEvents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: calendarKeys.noteEventsAll })
}

/** 회차의 노트 카드 — eventId 없으면 쉬고(새 일정), 연결이 없으면 data.note 가 null. */
export function useEventNote(eventId?: number, occurrenceDate?: string | null) {
  return useQuery<EventNoteLink>({
    queryKey: calendarKeys.eventNote(eventId ?? 0, occurrenceDate ?? null),
    queryFn: () => calendarApi.getNote(eventId as number, occurrenceDate).then((r) => r.data),
    enabled: typeof eventId === 'number' && Number.isFinite(eventId),
    retry: false,
  })
}

/** 노트 잇기 — 오류는 호출한 창이 안에 보인다(토스트 없음). 성공하면 응답 카드를 캐시에 넣는다. */
export function useLinkEventNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, occurrenceDate, pageId }: { id: number; occurrenceDate?: string | null; pageId: number }) =>
      calendarApi.linkNote(id, occurrenceDate, pageId).then((r) => r.data),
    onSuccess: (data, { id, occurrenceDate }) => {
      qc.setQueryData(calendarKeys.eventNote(id, occurrenceDate ?? null), data)
      invalidateNoteEvents(qc)
    },
  })
}

/** 연결 끊기 — 노트는 지우지 않는다. 성공하면 캐시를 「연결 없음」으로. */
export function useUnlinkEventNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, occurrenceDate }: { id: number; occurrenceDate?: string | null }) =>
      calendarApi.unlinkNote(id, occurrenceDate),
    onSuccess: (_d, { id, occurrenceDate }) => {
      qc.setQueryData<EventNoteLink>(calendarKeys.eventNote(id, occurrenceDate ?? null), { note: null })
      invalidateNoteEvents(qc)
    },
    onError: (e) => handleApiError(e, '회의록 연결을 해제하지 못했습니다'),
  })
}
