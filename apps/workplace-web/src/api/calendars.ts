import type { Calendar, CalendarRequest } from '../types/calendar'
import { client } from './client'

// 개인 캘린더(컨테이너) CRUD.
export const calendarsApi = {
  list: () => client.get<Calendar[]>('/calendars'),
  create: (body: CalendarRequest) => client.post<Calendar>('/calendars', body),
  update: (id: number, body: CalendarRequest) => client.patch<Calendar>(`/calendars/${id}`, body),
  remove: (id: number) => client.delete<void>(`/calendars/${id}`),
}
