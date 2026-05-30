// 6c: chat 메시지의 mentions 에서 대행할 AGENT 1명 선택 (다중 AGENT 는 비목표 — 첫 번째).
import type { ChatMessagePostedPayload } from '../types/chat-events.js';

export function pickMentionedAgentId(payload: ChatMessagePostedPayload): number | null {
  const agents = payload.mentions.filter((u) => u.kind === 'AGENT');
  return agents.length > 0 ? agents[0].id : null;
}
