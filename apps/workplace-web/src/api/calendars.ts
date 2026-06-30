import type { Calendar, CalendarRequest } from '../types/calendar'
import { client } from './client'

// 개인 캘린더(컨테이너) CRUD.
export const calendarsApi = {
  list: () => client.get<Calendar[]>('/calendars'),
  create: (body: CalendarRequest) => client.post<Calendar>('/calendars', body),
  update: (id: number, body: CalendarRequest) => client.patch<Calendar>(`/calendars/${id}`, body),
  remove: (id: number) => client.delete<void>(`/calendars/${id}`),
  // 한 캘린더의 모든 일정 강제 리셋(하드 삭제). 로컬 캘린더만 허용(서버 가드).
  resetEvents: (id: number) => client.post<void>(`/calendars/${id}/reset`),
}
