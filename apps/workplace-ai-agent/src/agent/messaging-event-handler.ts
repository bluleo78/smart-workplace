// 7: messaging.message.posted 핸들러 — self-loop 방어 후 background spawn.
import { trackInflight } from '../graceful-shutdown.js';
import { runMessagingAgent } from './run-messaging-agent.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';

export function handleMessagingEvent(
  env: MessagingEventEnvelope,
  deps: EventHandlerDeps,
): void {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (API 에서 이미 걸러지지만 이중 방어).
  if (env.payload.actor.kind === 'AGENT') return;

  // 종료 시 이 실행이 끝날 때까지 기다리도록 등록(WP-167)
  trackInflight(runMessagingAgent(env, deps)).catch((e) => {
    console.error('[messaging-event-handler] runMessagingAgent 실패', {
      channelId: env.payload.channelId,
      error: e instanceof Error ? e.message : String(e),
    });
  });
}
