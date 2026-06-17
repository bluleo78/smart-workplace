// 홈 대시보드 메일 요약 위젯 REST 호출. client(baseURL /api/v1) 사용.
import type { MailSummary } from '../types/dashboard'
import { client } from './client'

export const mailSummaryApi = {
  get: () => client.get<MailSummary>('/me/mail-summary').then((r) => r.data),
}
