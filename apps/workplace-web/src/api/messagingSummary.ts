// 홈 대시보드 대화 요약 위젯 REST 호출. client(baseURL /api/v1) 사용.
import type { MessagingSummary } from '../types/dashboard'
import { client } from './client'

export const messagingSummaryApi = {
  get: () => client.get<MessagingSummary>('/me/messaging-summary').then((r) => r.data),
}
