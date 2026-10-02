// 6c: chat.message.posted → runChatAgent fire-and-forget. self-loop 가드.
import { trackInflight } from '../graceful-shutdown.js';
import { runChatAgent } from './run-chat-agent.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

export function handleChatEvent(env: ChatEventEnvelope, deps: EventHandlerDeps): void {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (self-loop 차단). workplace-api 도 거르지만 이중.
  if (env.payload.actor.kind === 'AGENT') return;
  // 종료 시 이 실행이 끝날 때까지 기다리도록 등록(WP-167)
  trackInflight(runChatAgent(env, deps)).catch((e) => {
    console.error('[chat-event-handler] runChatAgent 실패', {
      threadId: env.payload.threadId,
      issueKey: env.payload.issueKey,
      error: e,
    });
  });
}
