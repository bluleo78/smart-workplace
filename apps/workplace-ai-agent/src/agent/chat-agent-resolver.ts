// 6c: chat 메시지의 대행 AGENT 는 API 가 정해 payload.actingAgentId 로 보낸다(WP-371).
// mentions 에서 첫 AGENT 로 추정하는 폴백은 두지 않는다(외부 실행 에이전트 오실행 방지, fail-closed).
import type { ChatMessagePostedPayload } from '../types/chat-events.js';

export function pickMentionedAgentId(payload: ChatMessagePostedPayload): number {
  return payload.actingAgentId;
}
