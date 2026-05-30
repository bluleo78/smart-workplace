// 6c: chat.message.posted → runChatAgent fire-and-forget. self-loop 가드.
import { runChatAgent } from './run-chat-agent.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

export function handleChatEvent(env: ChatEventEnvelope, deps: EventHandlerDeps): void {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (self-loop 차단). workplace-api 도 거르지만 이중.
  if (env.payload.actor.kind === 'AGENT') return;
  runChatAgent(env, deps).catch((e) => {
    console.error('[chat-event-handler] runChatAgent 실패', {
      threadId: env.payload.threadId,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
