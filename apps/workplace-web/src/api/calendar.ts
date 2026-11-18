import type { CalendarEvent, CalendarEventRequest, CalendarEventSearchResponse, EditScope, EventNoteLink, NoteLinkedEventsResponse, RsvpStatus } from '../types/calendar'
import { client } from './client'

// 반복 일정 편집/삭제 시 적용 범위·회차 식별용 쿼리 파라미터 (이슈 #111)
export interface ScopeParams {
  scope?: EditScope
  // 가상 회차의 시작 시각(불투명 문자열) — 서버가 준 값을 그대로 전달.
  occurrenceDate?: string | null
}

export const calendarApi = {
  // [from,to) 와 겹치는 내 일정.
  list: (from: string, to: string) =>
    client.get<CalendarEvent[]>('/calendar/events', { params: { from, to } }),
  // 일정 키워드 검색(WP-1357) — 제목·장소·참석자. cursor 는 서버가 준 nextCursor 를 그대로 되돌린다.
  search: (q: string, cursor: string | null, limit: number, signal?: AbortSignal) =>
    client.get<CalendarEventSearchResponse>('/calendar/events/search', {
      params: { q, ...(cursor ? { cursor } : {}), limit },
      signal,
    }),
  get: (id: number) => client.get<CalendarEvent>(`/calendar/events/${id}`),
  create: (body: CalendarEventRequest) => client.post<CalendarEvent>('/calendar/events', body),
  // PATCH — scope/occurrenceDate 는 제공된 경우에만 쿼리 파라미터로 전달.
  update: (id: number, body: CalendarEventRequest, params?: ScopeParams) =>
    client.patch<CalendarEvent>(`/calendar/events/${id}`, body, { params }),
  remove: (id: number, params?: ScopeParams) =>
    client.delete<void>(`/calendar/events/${id}`, { params }),
  // 일정에 참석자 초대 — POST /calendar/events/{id}/attendees (이슈 #489)
  invite: (id: number, userIds: number[]) =>
    client.post<void>(`/calendar/events/${id}/attendees`, { userIds }),
  // 참석자 제거 — DELETE /calendar/events/{id}/attendees/{userId} (이슈 #489)
  removeAttendee: (id: number, userId: number) =>
    client.delete<void>(`/calendar/events/${id}/attendees/${userId}`),
  // 내 RSVP 응답 — PATCH /calendar/events/{id}/rsvp (이슈 #489)
  rsvp: (id: number, status: RsvpStatus) =>
    client.patch<void>(`/calendar/events/${id}/rsvp`, { status }),
  // 일정(회차)의 회의록 노트 — 반복 일정은 occurrenceDate 로 회차를 가른다(WP-1701)
  getNote: (id: number, occurrenceDate?: string | null) =>
    client.get<EventNoteLink>(`/calendar/events/${id}/note`, { params: noteParams(occurrenceDate) }),
  linkNote: (id: number, occurrenceDate: string | null | undefined, pageId: number) =>
    client.put<EventNoteLink>(`/calendar/events/${id}/note`, { pageId }, { params: noteParams(occurrenceDate) }),
  unlinkNote: (id: number, occurrenceDate?: string | null) =>
    client.delete<void>(`/calendar/events/${id}/note`, { params: noteParams(occurrenceDate) }),
  // 노트에 이어진 일정 — 읽을 수 없는 노트는 404(WP-1703)
  listNoteEvents: (pageId: number) =>
    client.get<NoteLinkedEventsResponse>(`/calendar/notes/${pageId}/events`),
}

// occurrenceDate 는 값이 있을 때만 쿼리로 보낸다(반복 아님·override 행은 서버가 무시)
function noteParams(occurrenceDate?: string | null) {
  return occurrenceDate ? { occurrenceDate } : undefined
}
