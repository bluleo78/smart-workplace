// 이벤트 수신 — workplace-api 가 푸시한 이벤트를 즉시 202 응답하고 background 처리.
import { Router } from 'express';
import { z } from 'zod';

import { handleEvent, type EventHandlerDeps } from '../agent/event-handler.js';
import { handleChatEvent } from '../agent/chat-event-handler.js';
import { handleMessagingEvent } from '../agent/messaging-event-handler.js';
import {
  KNOWN_ISSUE_TYPES,
  issueEventEnvelope,
} from '../types/issue-events.js';
import { chatEventEnvelope, CHAT_MESSAGE_POSTED } from '../types/chat-events.js';
import { messagingEventEnvelope, MESSAGING_MESSAGE_POSTED } from '../types/messaging-events.js';
import { AI_RUN_HEADER } from '../ai-run/header.js';
import { openAiRunScope, safeClose } from '../ai-run/open-scope.js';
import { kindForEvent } from '../ai-run/kinds.js';
import { noopAiRunSink, withAiRunScope } from '../ai-run/scope.js';
import type { AiRunContext, AiRunSink } from '../ai-run/types.js';

const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
});

/** 행위자(actor) 종류 → 기록의 주체 종류. AGENT 만 AGENT, 그 밖은 USER. */
function actorCtx(actor: { id: number; kind: string }): Pick<AiRunContext, 'actorType' | 'actorId'> {
  return { actorType: actor.kind === 'AGENT' ? 'AGENT' : 'USER', actorId: actor.id };
}

/** 이벤트 시각을 ISO-8601(UTC)로 맞춘다. 읽을 수 없으면 undefined — API 묶음 전체가 400 나지 않게 이 필드만 비운다(WP-1828). */
function isoOrUndefined(v: string): string | undefined {
  return Number.isNaN(Date.parse(v)) ? undefined : new Date(v).toISOString();
}

/**
 * 이벤트를 AI 처리 한 건의 범위로 열어 handler 를 돌리고, 처리 promise 결과로 닫는다 (WP-1828).
 * 헤더(X-AI-Run)의 값이 이벤트에서 뽑은 값보다 필드별로 우선한다.
 * handler 는 이 이벤트로 시작한 실행 promise(이미 inflight 등록·catch 로그됨)를 돌려주고, 여기서 .then(ok, fail) 로
 * 관찰만 한다 — 거부 핸들러를 달아 두므로 새 unhandled rejection 이 생기지 않는다. undefined(합쳐짐·무시)는 성공으로 닫고,
 * 러너가 안 불렸으면 아무것도 기록되지 않는다. 기록 쪽 오류는 모두 삼켜 202 응답·처리 결과에 영향이 없다.
 */
function runInScope(
  type: string,
  headerRaw: string | string[] | undefined,
  derived: AiRunContext,
  sink: AiRunSink,
  handler: () => Promise<unknown> | undefined,
): void {
  const kind = kindForEvent(type);
  const scope = kind ? openAiRunScope(kind, headerRaw, derived, sink) : undefined;
  if (!scope) {
    handler();
    return;
  }
  let run: Promise<unknown> | undefined;
  try {
    run = withAiRunScope(scope, handler);
  } catch (err) {
    // 핸들러의 동기 예외는 기록 때문에 바꾸지 않고 그대로 던진다(기존 동작 유지) — 범위만 닫는다.
    safeClose(scope, { ok: false, reason: 'handler_error', detail: String(err) });
    throw err;
  }
  if (run === undefined) {
    safeClose(scope, { ok: true });
    return;
  }
  run.then(
    () => safeClose(scope, { ok: true }),
    (err: unknown) => safeClose(scope, { ok: false, reason: 'handler_error', detail: String(err) }),
  );
}

export function createEventsRouter(deps: EventHandlerDeps): Router {
  const sink = deps.aiRunSink ?? noopAiRunSink;
  const router = Router();

  router.post('/events', (req, res) => {
    const envelope = envelopeSchema.safeParse(req.body);
    if (!envelope.success) {
      res
        .status(400)
        .json({ error: 'invalid_payload', issues: envelope.error.issues });
      return;
    }

    const { type } = envelope.data;

    // 6c: chat 이벤트 분기 — 별도 스키마/핸들러.
    if (type === CHAT_MESSAGE_POSTED) {
      const chat = chatEventEnvelope.safeParse(req.body);
      if (!chat.success) {
        res.status(400).json({ error: 'invalid_payload', issues: chat.error.issues });
        return;
      }
      const p = chat.data.payload;
      runInScope(
        type,
        req.headers[AI_RUN_HEADER],
        {
          targetType: 'ISSUE',
          targetId: String(p.issueId),
          targetLabel: p.issueKey,
          ...actorCtx(p.actor),
          sourceAt: isoOrUndefined(p.occurredAt),
        },
        sink,
        () => handleChatEvent(chat.data, deps),
      );
      res.status(202).json({ received: true });
      return;
    }

    // 7: messaging 이벤트 분기 — 별도 스키마/핸들러.
    if (type === MESSAGING_MESSAGE_POSTED) {
      const m = messagingEventEnvelope.safeParse(req.body);
      if (!m.success) {
        res.status(400).json({ error: 'invalid_payload', issues: m.error.issues });
        return;
      }
      const p = m.data.payload;
      runInScope(
        type,
        req.headers[AI_RUN_HEADER],
        {
          targetType: 'CHANNEL',
          targetId: String(p.channelId),
          ...actorCtx(p.actor),
          sourceAt: isoOrUndefined(p.occurredAt),
        },
        sink,
        () => handleMessagingEvent(m.data, deps),
      );
      res.status(202).json({ received: true });
      return;
    }

    const parsed = issueEventEnvelope.safeParse(req.body);
    if (!parsed.success) {
      if (KNOWN_ISSUE_TYPES.has(type)) {
        res
          .status(400)
          .json({ error: 'invalid_payload', issues: parsed.error.issues });
        return;
      }
      res.status(400).json({ error: 'unsupported_event_type', type });
      return;
    }

    const ev = parsed.data;
    const p = ev.payload;
    const derived: AiRunContext = {
      targetType: 'ISSUE',
      targetId: String(p.issueId),
      targetLabel: p.issueKey,
    };
    if (ev.type === 'issue.recurring_run' || ev.type === 'issue.recurring_test_run') {
      // 반복 회차는 자동 실행 — 주체는 AUTO, 소유자·회차 시각·테넌트는 payload 에서 온다.
      derived.actorType = 'AUTO';
      derived.actorId = ev.payload.ownerUserId;
      derived.sourceAt = isoOrUndefined(ev.payload.runAt);
      if (ev.payload.tenantId != null) derived.tenantId = ev.payload.tenantId;
    } else {
      Object.assign(derived, actorCtx(p.actor), { sourceAt: isoOrUndefined(p.occurredAt) });
    }
    runInScope(type, req.headers[AI_RUN_HEADER], derived, sink, () => handleEvent(ev, deps));
    res.status(202).json({ received: true });
  });

  return router;
}
