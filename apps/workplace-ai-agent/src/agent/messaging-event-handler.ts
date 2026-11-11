// 7: messaging.message.posted 핸들러 — self-loop 방어 후 background spawn.
// WP-1490: 같은 대화의 실행은 하나만 — 실행 중에 온 메시지는 끝난 뒤 한 번에 다시 처리한다(run-coalescer).
import { runMessagingAgent } from './run-messaging-agent.js';
import { createRunCoalescer, DEFAULT_MAX_RUN_MS, type RunCoalescer } from './run-coalescer.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';

/** 이벤트와 그때의 의존성을 함께 기억한다(다시 실행할 때 같은 deps 로 돈다). */
interface QueuedRun {
  env: MessagingEventEnvelope;
  deps: EventHandlerDeps;
}

/** 대화 키 — 채널 + (스레드면 부모 메시지) + 답할 AI. 다른 채널·스레드·AI 끼리는 서로 막지 않는다. */
export function messagingRunKey(env: MessagingEventEnvelope): string {
  const p = env.payload;
  return `${p.channelId}:${p.triggerParentMessageId ?? 'root'}:${p.respondAsAgentId}`;
}

/** 실행기로 합치기를 만든다 — 테스트는 가짜 실행기로 만들어 쓴다. */
export function createMessagingRunner(
  run: (env: MessagingEventEnvelope, deps: EventHandlerDeps) => Promise<unknown>,
  maxRunMs: number = DEFAULT_MAX_RUN_MS,
): RunCoalescer<QueuedRun> {
  return createRunCoalescer<QueuedRun>(
    (q) => messagingRunKey(q.env),
    (q) => run(q.env, q.deps),
    (q, e) => {
      console.error('[messaging-event-handler] runMessagingAgent 실패', {
        channelId: q.env.payload.channelId,
        error: e instanceof Error ? e.message : String(e),
      });
    },
    maxRunMs,
  );
}

const runner = createMessagingRunner(runMessagingAgent);

export function handleMessagingEvent(
  env: MessagingEventEnvelope,
  deps: EventHandlerDeps,
): void {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (API 에서 이미 걸러지지만 이중 방어).
  if (env.payload.actor.kind === 'AGENT') return;

  // 종료 대기 등록(WP-167)은 합치기가 다시 실행까지 묶어 한다.
  runner.submit({ env, deps });
}
