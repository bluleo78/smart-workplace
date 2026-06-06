// 백엔드 NotificationResponse 와 1:1 매칭.
export interface NotificationResponse {
  id: number
  type: 'ASSIGNED' | 'COMMENTED' | 'STATUS_CHANGED' | 'REMINDER'
  actorId: number | null
  actorName: string | null
  actorKind: string | null // 'HUMAN' | 'AGENT' | null
  issueId: number
  projectKey: string
  issueNumber: number
  issueTitle: string
  commentId: number | null
  // REMINDER 타입 전용 — 일정 알림 정보 (이슈 #110). 그 외 타입에선 null.
  eventId: number | null
  eventTitle: string | null
  eventStartsAt: string | null
  read: boolean
  createdAt: string
}
