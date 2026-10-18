// 백엔드 NotificationResponse 와 1:1 매칭.
export interface NotificationResponse {
  id: number
  type:
    | 'ASSIGNED'
    | 'COMMENTED'
    | 'STATUS_CHANGED'
    | 'PRIORITY_CHANGED'
    | 'REMINDER'
    | 'CALENDAR_INVITED'
    | 'CALENDAR_RSVP_CHANGED'
    // WP-452: 이슈 챗 알림 — AI 가 답변 필요 질문을 올림 / 이슈 챗 글에서 나를 멘션.
    | 'AI_QUESTION'
    | 'ISSUE_CHAT_MENTION'
  actorId: number | null
  actorName: string | null
  actorKind: string | null // 'HUMAN' | 'AGENT' | null
  issueId: number
  projectKey: string
  issueNumber: number
  issueTitle: string
  commentId: number | null
  // REMINDER/CALENDAR_INVITED/CALENDAR_RSVP_CHANGED 타입 전용 — 일정 알림 정보 (이슈 #110, #489). 그 외 타입에선 null.
  eventId: number | null
  eventTitle: string | null
  eventStartsAt: string | null
  read: boolean
  createdAt: string
}
