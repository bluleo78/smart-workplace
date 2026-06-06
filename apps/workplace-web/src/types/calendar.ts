// 캘린더 일정 — 백엔드 DTO 1:1.
export type CalendarViewType = 'month' | 'week' | 'day' | 'agenda'

export interface CalendarEvent {
  id: number
  title: string
  description: string | null
  startsAt: string // ISO (UTC)
  endsAt: string // ISO (UTC)
  allDay: boolean
  location: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface CalendarEventRequest {
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  location: string | null
  color: string | null
}
