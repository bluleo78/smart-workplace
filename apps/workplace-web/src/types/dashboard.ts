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
  | 'id'
  | 'accountId'
  | 'subject'
  | 'fromAddress'
  | 'fromName'
  | 'snippet'        // 본문 미리보기(백엔드 이미 전송)
  | 'receivedAt'
  | 'seen'
  | 'hasAttachment'  // 첨부 표시(백엔드 이미 전송)
  | 'aiCategory'
  | 'aiNeedsReply'
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

// 홈 대화 요약 위젯 — 대화 한 행. 백엔드 ConversationSummaryItem 미러.
// kind: DM(1:1 직접 메시지) vs CHANNEL(채널 대화).
// needsReply: DM 안 읽음 기반 회신 대기 신호. mentioned: 멘션 포함 여부.
export interface ConversationSummaryItem {
  kind: 'DM' | 'CHANNEL'
  conversationId: number
  label: string
  lastAuthorName: string | null
  lastMessagePreview: string
  lastMessageAt: string | null
  unreadCount: number
  mentioned: boolean
  needsReply: boolean
  newThreadReplyCount: number
}

// 홈 대화 요약 위젯 데이터(백엔드 MessagingSummaryResponse 와 1:1).
// unreadConversationCount: 안 읽은 대화 수. needsReplyCount: 회신 대기 대화 수.
export interface MessagingSummary {
  unreadConversationCount: number
  needsReplyCount: number
  recent: ConversationSummaryItem[]
}
