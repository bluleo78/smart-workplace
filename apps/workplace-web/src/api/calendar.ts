import type { CalendarEvent, CalendarEventRequest, EditScope } from '../types/calendar'
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
  get: (id: number) => client.get<CalendarEvent>(`/calendar/events/${id}`),
  create: (body: CalendarEventRequest) => client.post<CalendarEvent>('/calendar/events', body),
  // PATCH — scope/occurrenceDate 는 제공된 경우에만 쿼리 파라미터로 전달.
  update: (id: number, body: CalendarEventRequest, params?: ScopeParams) =>
    client.patch<CalendarEvent>(`/calendar/events/${id}`, body, { params }),
  remove: (id: number, params?: ScopeParams) =>
    client.delete<void>(`/calendar/events/${id}`, { params }),
}
