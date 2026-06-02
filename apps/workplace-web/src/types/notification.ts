// 백엔드 NotificationResponse 와 1:1 매칭.
export interface NotificationResponse {
  id: number
  type: 'ASSIGNED' | 'COMMENTED' | 'STATUS_CHANGED'
  actorId: number | null
  actorName: string | null
  actorKind: string | null // 'HUMAN' | 'AGENT' | null
  issueId: number
  projectKey: string
  issueNumber: number
  issueTitle: string
  commentId: number | null
  read: boolean
  createdAt: string
}
