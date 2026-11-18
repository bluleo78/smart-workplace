// 일정(회차)의 회의록 노트 조회·잇기·끊기(WP-1701).
// 조회는 전용 GET — 상세 GET 은 반복이면 마스터를 돌려줘 회차 키가 없다. 잇기·끊기 응답은 setQueryData 로 바로 카드에 반영한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { calendarApi } from '../../api/calendar'
import { handleApiError } from '../../lib/api-error'
import type { EventNoteLink } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

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
    },
    onError: (e) => handleApiError(e, '회의록 연결을 해제하지 못했습니다'),
  })
}
