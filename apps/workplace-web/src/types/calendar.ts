// 캘린더 일정 — 백엔드 DTO 1:1.
export type CalendarViewType = 'month' | 'week' | 'day' | 'agenda'

// 반복 일정 편집/삭제 적용 범위 (이슈 #111)
// THIS = 이 회차만, THIS_AND_FOLLOWING = 이후 모든 회차, ALL = 전체 시리즈
export type EditScope = 'THIS' | 'THIS_AND_FOLLOWING' | 'ALL'

// 참석자 RSVP 응답 상태 (이슈 #489)
export type RsvpStatus = 'NEEDS_ACTION' | 'ACCEPTED' | 'DECLINED' | 'TENTATIVE'

// 참석자 역할 — ORGANIZER(주최자) | ATTENDEE(참석자)
export type AttendeeRole = 'ORGANIZER' | 'ATTENDEE'

/** 일정 참석자 (GET /events/{id} 에서만 반환) */
export interface Attendee {
  userId: number | null // 외부 참석자는 null
  username: string | null
  name: string
  kind: 'HUMAN' | 'AGENT' | 'EXTERNAL'
  role: AttendeeRole
  rsvpStatus: RsvpStatus
  invitedByUserId: number | null
  externalEmail: string | null
}

export interface CalendarEvent {
  id: number
  title: string
  description: string | null
  startsAt: string // ISO (UTC)
  endsAt: string // ISO (UTC)
  allDay: boolean
  location: string | null
  color: string | null
  calendarId: number
  calendarName: string | null
  effectiveColor: string
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
  // 참석자 카운트 (주최자 포함). 목록/상세 모두 반환. (이슈 #489)
  attendeeCount?: number
  // 현재 사용자의 RSVP 상태. 참석자가 아니면 null. (이슈 #489)
  myRsvpStatus?: RsvpStatus | null
  // 참석자 목록 — GET /events/{id} 에서만 채워짐. (이슈 #489)
  attendees?: Attendee[] | null
  // 외부 동기화 일정 여부(GET 에서만). true 면 참석자/RSVP 읽기 전용. (#547)
  external?: boolean
  // 현재 사용자의 참석자 역할(GET 에서만). 'ORGANIZER' 면 참석자 편집 가능. (#547)
  myRole?: string | null
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
  // 생성 시 초대할 참석자 userId 목록 (주최자 제외). 미전달 시 빈 배열. (이슈 #489)
  attendeeUserIds?: number[]
  calendarId?: number | null
}

// 개인 캘린더(컨테이너).
export interface Calendar {
  id: number
  name: string
  color: string
  isDefault: boolean
  position: number
  // M365 등 외부 동기화 컨테이너인 경우 true — 이름·색 편집·삭제 불가. (이슈 #501)
  isReadOnly: boolean
}

// 캘린더 생성/수정 요청.
export interface CalendarRequest {
  name: string
  color: string
  position?: number
}
