// 노트에 이어진 일정 목록(WP-1703). pageId 없으면 쉰다. 읽을 수 없는 노트(404)는 재시도하지 않는다.
import { useQuery } from '@tanstack/react-query'

import { calendarApi } from '../../api/calendar'
import type { NoteLinkedEventsResponse } from '../../types/calendar'
import { calendarKeys } from './calendarKeys'

export function useNoteLinkedEvents(pageId: number | null) {
  return useQuery<NoteLinkedEventsResponse>({
    queryKey: calendarKeys.noteEvents(pageId ?? 0),
    queryFn: () => calendarApi.listNoteEvents(pageId as number).then((r) => r.data),
    enabled: pageId != null,
    retry: false,
    staleTime: 30_000,
  })
}
