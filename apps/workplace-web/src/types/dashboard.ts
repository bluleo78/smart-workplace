// 홈 대시보드 데이터 타입 — 백엔드 DTO 와 1:1 매칭.
import type { EmailMessageSummary } from './mailMessage'

// 위젯 한 개의 구성 — 타입 키 + 항목 수(3·5·10) + 숨김 여부.
// 백엔드 객체-배열 컨트랙트와 1:1. count 는 {3,5,10} 만 허용(서버가 그 외 400).
export interface DashboardWidgetConfig {
  type: string
  count: number
  hidden: boolean
}

// 홈 대시보드 레이아웃 — 위젯 구성의 정렬된 배열(순서 = 렌더 순서).
export interface DashboardLayout {
  widgets: DashboardWidgetConfig[]
}

// 메일 요약 위젯의 최근 메일 한 행.
// 기존 메일 기능의 EmailMessageSummary 와 필드명을 일치시킨다(발신자 분리 fromAddress/fromName,
// 읽음 여부 seen, subject/receivedAt 는 nullable). 위젯에 필요한 필드만 Pick.
// accountId: AI 분류 회신 필요 메일의 딥링크(/mail/${accountId}?messageId=${id}) 생성에 사용.
export type MailSummaryItem = Pick<
  EmailMessageSummary,
  'id' | 'accountId' | 'subject' | 'fromAddress' | 'fromName' | 'receivedAt' | 'seen' | 'aiCategory' | 'aiNeedsReply'
>

// 메일 요약 위젯 데이터(백엔드 MailSummaryResponse 와 1:1).
// needsReplyCount: AI 회신 필요 판정 건수(classificationActive=true 시에만 유효).
// classificationActive: AI 메일 분류 기능 활성 여부(계정별 aiEnabled 합산).
export interface MailSummary {
  unreadCount: number
  needsReplyCount: number
  classificationActive: boolean
  recent: MailSummaryItem[]
}
