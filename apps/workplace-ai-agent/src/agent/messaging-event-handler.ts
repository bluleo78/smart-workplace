// 7: messaging.message.posted 핸들러 — self-loop 방어 후 background spawn.
import { runMessagingAgent } from './run-messaging-agent.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';

export function handleMessagingEvent(
  env: MessagingEventEnvelope,
  deps: EventHandlerDeps,
): void {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (API 에서 이미 걸러지지만 이중 방어).
  if (env.payload.actor.kind === 'AGENT') return;

  runMessagingAgent(env, deps).catch((e) => {
    console.error('[messaging-event-handler] runMessagingAgent 실패', {
      channelId: env.payload.channelId,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}
