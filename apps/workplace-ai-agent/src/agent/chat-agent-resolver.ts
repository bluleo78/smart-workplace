// 6c: chat 메시지에서 대행할 AGENT 1명 선택. payload.actingAgentId(WP-371)가 있으면 우선하고,
// 없으면(구버전 API) mentions 의 첫 AGENT 로 폴백한다.
import type { ChatMessagePostedPayload } from '../types/chat-events.js';

export function pickMentionedAgentId(payload: ChatMessagePostedPayload): number | null {
  if (payload.actingAgentId != null) return payload.actingAgentId;
  const agents = payload.mentions.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
