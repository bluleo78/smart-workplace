import type { EmailMessageSummary } from '@/types/mailMessage'

/**
 * 회신필요 판정 단일 술어 (WP-146) — AI 가 회신 필요로 판정(true)하고 아직 읽지 않은 메일.
 * 서버 EmailMessageRepository.needsReplyCondition() 과 같은 기준이며, 화면마다 기준이 어긋나지 않도록
 * 웹의 모든 회신필요 판정은 이 함수를 쓴다. pending(null)은 AI 판정 전이므로 제외한다.
 */
export function isNeedsReply(m: Pick<EmailMessageSummary, 'aiNeedsReply' | 'seen'>): boolean {
  return m.aiNeedsReply === true && !m.seen
}
