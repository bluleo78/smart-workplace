// 홈 AI 우선순위 항목 조회 — GET /me/priority-items. mailSummary.ts 패턴 미러.
import { client } from './client'

export interface PriorityItem {
  sourceType: string
  sourceId: string
  title: string
  deepLink: string
  importanceScore: number
  urgencyScore: number
  reason: string
}

export interface PriorityItemsResponse {
  items: PriorityItem[]
}

export const priorityItemsApi = {
  get: () => client.get<PriorityItemsResponse>('/me/priority-items').then((r) => r.data),
}
