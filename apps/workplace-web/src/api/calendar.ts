import type { CalendarEvent, CalendarEventRequest } from '../types/calendar'
import { client } from './client'

export const calendarApi = {
  // [from,to) 와 겹치는 내 일정.
  list: (from: string, to: string) =>
    client.get<CalendarEvent[]>('/calendar/events', { params: { from, to } }),
  get: (id: number) => client.get<CalendarEvent>(`/calendar/events/${id}`),
  create: (body: CalendarEventRequest) => client.post<CalendarEvent>('/calendar/events', body),
  update: (id: number, body: CalendarEventRequest) =>
    client.patch<CalendarEvent>(`/calendar/events/${id}`, body),
  remove: (id: number) => client.delete<void>(`/calendar/events/${id}`),
}
