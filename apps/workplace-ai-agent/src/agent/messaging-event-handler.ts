// 7: messaging.message.posted 핸들러 — self-loop 방어 후 background spawn.
// WP-1979: 파드 사이에서도 하나만 — shared-run-coalescer 가 api 임대를 쓴다.
// WP-1490: 같은 대화의 실행은 하나만 — 실행 중에 온 메시지는 끝난 뒤 한 번에 다시 처리한다(run-coalescer).
import axios from 'axios';
import { runMessagingAgent } from './run-messaging-agent.js';
import { createRunCoalescer, DEFAULT_MAX_RUN_MS, type RunCoalescer } from './run-coalescer.js';
import type { EventHandlerDeps } from './event-handler.js';
import { messagingEventEnvelope, type MessagingEventEnvelope } from '../types/messaging-events.js';
import { createSharedRunCoalescer, type RunLeaseStore } from './shared-run-coalescer.js';

/** 이벤트와 그때의 의존성을 함께 기억한다(다시 실행할 때 같은 deps 로 돈다). */
interface QueuedRun {
  env: MessagingEventEnvelope;
  baseDeps: EventHandlerDeps;
  deps: EventHandlerDeps;
}

/** 이벤트에 테넌트가 있으면 원본 client 에서 해당 이벤트 전용 client 를 만든다. */
function messagingEventDeps(env: MessagingEventEnvelope, baseDeps: EventHandlerDeps): EventHandlerDeps {
  const tenantId = env.payload.tenantId;
  if (tenantId === undefined) return baseDeps;
  return { ...baseDeps, client: baseDeps.client.withOnBehalfOfTenant(tenantId) };
}

/** 실행 실패 로그 — 메모리 합치기와 공유 임대 합치기가 같이 쓴다. */
function logRunError(q: QueuedRun, e: unknown): void {
  console.error('[messaging-event-handler] runMessagingAgent 실패', {
    channelId: q.env.payload.channelId,
    error: e instanceof Error ? e.message : String(e),
  });
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
    logRunError,
    maxRunMs,
  );
}

/** 검증 못 한 밀린 이벤트를 버리며 다시 반납하는 최대 횟수. */
const MAX_DROP_RELEASES = 10;

/** 이벤트의 deps.client 로 api 임대 저장소를 만든다 — 키는 이벤트 payload 에서 얻는다. */
function messagingLeaseStore(q: QueuedRun): RunLeaseStore<QueuedRun> {
  const p = q.env.payload;
  const key = {
    channelId: p.channelId,
    parentMessageId: p.triggerParentMessageId ?? null,
    agentId: p.respondAsAgentId,
  };
  return {
    async acquire(e, leaseMs, token) {
      const res = await q.deps.client.acquireMessagingRun(key, { messageId: e.env.payload.messageId, leaseMs, event: e.env, token });
      // DUPLICATE 로 버려진 이벤트를 추적할 수 있게 남긴다.
      if (res.status === 'DUPLICATE') {
        console.info('[messaging-event-handler] 임대 acquire DUPLICATE — 이미 처리 중이거나 처리한 메시지라 건너뜀', {
          channelId: key.channelId,
          parentMessageId: key.parentMessageId,
          agentId: key.agentId,
          messageId: e.env.payload.messageId,
        });
      }
      return res;
    },
    async release(e, token, leaseMs) {
      // 서버는 밀린 이벤트를 줄 때 임대를 우리에게 이어서 갱신해 둔다 — 그 이벤트를 버리면 임대를 다시 반납해야
      // 대화가 풀린다. 그래서 검증에 실패하면 경고 후 같은 토큰으로 다시 반납한다(상한을 두어 무한 반복을 막는다).
      for (let i = 0; i < MAX_DROP_RELEASES; i++) {
        const { next } = await q.deps.client.releaseMessagingRun(key, { token, leaseMs });
        if (next == null) return null;
        const parsed = messagingEventEnvelope.safeParse(next);
        if (parsed.success) {
          // release 가 돌려준 이벤트마다 그 이벤트의 테넌트로 범위를 다시 정한다 — 앞 이벤트의 범위를 이어 쓰지 않는다.
          return { env: parsed.data, baseDeps: e.baseDeps, deps: messagingEventDeps(parsed.data, e.baseDeps) };
        }
        console.warn('[messaging-event-handler] 밀린 이벤트 검증 실패 — 버리고 다시 반납', { channelId: p.channelId });
      }
      // 상한까지 다시 반납해도 검증 못 한 이벤트만 왔다 — 더 반납하지 않으므로 임대는 만료될 때까지 잡힌 채 남는다.
      console.warn('[messaging-event-handler] 다시 반납 상한 도달 — 임대는 만료될 때까지 잡힌 채 남는다', {
        channelId: p.channelId,
        maxReleases: MAX_DROP_RELEASES,
      });
      return null;
    },
  };
}

/**
 * acquire 실패가 서버 커밋 뒤 응답 유실일 수 있는가 — HTTP 응답이 없는 실패(타임아웃·연결 끊김)나 게이트웨이 오류(502/503/504)만 true.
 * 그 밖의 HTTP 응답(404 구버전 api·403·400·500)은 서버가 확실히 거절한 것이라 반납할 임대가 없다.
 */
function acquireMayHaveCommitted(e: unknown): boolean {
  if (axios.isAxiosError(e) && e.response) return [502, 503, 504].includes(e.response.status);
  return true;
}

// WP-1979: 파드 사이 공유 임대(api)로 합치고, 임대를 못 쓰면 이 프로세스 메모리 합치기로 대체한다.
const runner = createSharedRunCoalescer<QueuedRun>({
  store: messagingLeaseStore,
  fallback: createMessagingRunner(runMessagingAgent),
  run: (q) => runMessagingAgent(q.env, q.deps),
  onError: logRunError,
  key: (q) => messagingRunKey(q.env),
  mayHaveCommitted: acquireMayHaveCommitted,
  // 메시지 id 는 DB 순번이라 더 새 메시지 = 더 큰 id(서버 DUPLICATE 판정과 같은 기준).
  order: (q) => q.env.payload.messageId,
});

// WP-1828: 실행 결과 promise — WP-1979 부터 임대 결과를 기다려야 하므로 AGENT 메시지 거름이 아니면 항상 promise 이고,
// 다른 실행에 합쳐졌으면 실행 없이 바로 이행한다(호출부의 기록 범위는 빈 채로 닫힌다). 처리 안 하면 undefined.
export function handleMessagingEvent(
  env: MessagingEventEnvelope,
  deps: EventHandlerDeps,
): Promise<void> | undefined {
  // AGENT 가 작성한 메시지엔 응답하지 않음 (API 에서 이미 걸러지지만 이중 방어).
  if (env.payload.actor.kind === 'AGENT') return undefined;

  // 임대와 실행이 같은 워크스페이스를 보도록 이벤트 범위를 저장한다 — release 가 준 다음 이벤트에는 다시 적용한다.
  const queued: QueuedRun = { env, baseDeps: deps, deps: messagingEventDeps(env, deps) };

  // 종료 대기 등록(WP-167)은 합치기가 다시 실행까지 묶어 한다.
  return runner.submit(queued);
}
