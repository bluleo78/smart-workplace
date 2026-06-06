// 캘린더 일정 — 백엔드 DTO 1:1.
export type CalendarViewType = 'month' | 'week' | 'day' | 'agenda'

// 반복 일정 편집/삭제 적용 범위 (이슈 #111)
// THIS = 이 회차만, THIS_AND_FOLLOWING = 이후 모든 회차, ALL = 전체 시리즈
export type EditScope = 'THIS' | 'THIS_AND_FOLLOWING' | 'ALL'

export interface CalendarEvent {
  id: number
  title: string
  description: string | null
  startsAt: string // ISO (UTC)
  endsAt: string // ISO (UTC)
  allDay: boolean
  location: string | null
  color: string | null
  // 시작 N분 전 리마인더(분). null = 알림 없음 (이슈 #110)
  reminderMinutes: number | null
  // RRULE 문자열(반복 규칙). null = 반복 없음 (이슈 #111)
  recurrenceRule: string | null
  // 반복 마스터 일정 id. null = 단일/마스터 자체 (이슈 #111)
  masterEventId?: number | null
  // 가상 occurrence 의 시작 시각(ISO, 불투명 문자열로 취급 — 가공 금지) (이슈 #111)
  occurrenceDate?: string | null
  createdAt: string
  updatedAt: string
}

// 캘린더에 읽기전용으로 오버레이되는 "내게 할당된 이슈 마감일" 마커.
// 캘린더 백엔드는 이슈를 모르므로(모듈 경계) 프론트에서 issue API(/me/issues)와 병합한다.
export interface IssueDueMarker {
  issueId: number
  projectKey: string
  number: number
  title: string
  dueDate: string // yyyy-MM-dd (백엔드 LocalDate, 날짜 단위)
}

export interface CalendarEventRequest {
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  allDay: boolean
  location: string | null
  color: string | null
  // 시작 N분 전 리마인더(분). null = 알림 없음 (이슈 #110)
  reminderMinutes: number | null
  // RRULE 문자열(반복 규칙). null = 반복 없음 (이슈 #111)
  recurrenceRule: string | null
}
