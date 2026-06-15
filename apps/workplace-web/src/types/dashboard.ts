// 홈 대시보드 데이터 타입 — 백엔드 DTO 와 1:1 매칭.
import type { EmailMessageSummary } from './mailMessage'

// 홈 대시보드 레이아웃 — 위젯 타입 키의 정렬된 배열.
export interface DashboardLayout {
  widgets: string[]
}

// 메일 요약 위젯의 최근 메일 한 행.
// 기존 메일 기능의 EmailMessageSummary 와 필드명을 일치시킨다(발신자 분리 fromAddress/fromName,
// 읽음 여부 seen, subject/receivedAt 는 nullable). 위젯에 필요한 필드만 Pick.
export type MailSummaryItem = Pick<
  EmailMessageSummary,
  'id' | 'subject' | 'fromAddress' | 'fromName' | 'receivedAt' | 'seen'
>

// 메일 요약 위젯 데이터(백엔드 MailSummaryResponse 와 1:1).
export interface MailSummary {
  unreadCount: number
  recent: MailSummaryItem[]
}
