// POST /events — envelope 검증 + payload 재검증 + handleEvent 단일 진입.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));
// WP-989: 반복 회차 실행 — 라우팅만 검증한다(실행은 run-recurring.test.ts).
vi.mock('../agent/run-recurring.js', () => ({
  runRecurring: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../agent/chat-event-handler.js', () => ({
  handleChatEvent: vi.fn(),
}));
vi.mock('../agent/messaging-event-handler.js', () => ({
  handleMessagingEvent: vi.fn(),
}));

import { internalAuth } from '../middleware/internal-auth.js';
import { createEventsRouter } from './events.js';
import { runAgent } from '../agent/run-agent.js';
import { runRecurring } from '../agent/run-recurring.js';
import { handleChatEvent } from '../agent/chat-event-handler.js';
import { handleMessagingEvent } from '../agent/messaging-event-handler.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import { currentAiRunScope } from '../ai-run/scope.js';
import type { AiRunRecord } from '../ai-run/types.js';

/** X-AI-Run 헤더 값(base64url(JSON))을 만드는 테스트용 보조 함수(WP-1828). */
const encodeAiRunHeader = (ctx: object) => Buffer.from(JSON.stringify(ctx)).toString('base64url');

const client = {
  addIssueComment: vi.fn(),
  unassignSelf: vi.fn(),
  getOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;

function buildApp(aiRunSink?: { enqueue: (r: AiRunRecord) => void }) {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createEventsRouter({ client, aiRunSink }));
  return app;
}

const VALID = 'test-token-12345';
const AUTH = `Internal ${VALID}`;

const validCreatedPayload = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' }],
  occurredAt: '2026-05-25T12:00:00Z',
  actingAgentId: 201,
  status: 'TODO',
  priority: 'MID',
};

describe('POST /events', () => {
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = VALID;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runAgent).mockClear();
    vi.mocked(runAgent).mockResolvedValue(undefined);
    vi.mocked(handleChatEvent).mockClear();
    vi.mocked(handleMessagingEvent).mockClear();
  });
  afterEach(() => {
    delete process.env.INTERNAL_SERVICE_TOKEN;
    vi.restoreAllMocks();
  });

  it('인증 없음 → 401', async () => {
    const res = await request(buildApp())
      .post('/events')
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(401);
  });

  it('envelope 누락(type 없음) → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ payload: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('알 수 없는 type → 400 unsupported_event_type', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'wiki.created', payload: { foo: 'bar' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_event_type',
      type: 'wiki.created',
    });
  });

  it('알려진 prefix 의 unknown literal → 400 unsupported_event_type', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.foo', payload: validCreatedPayload });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'unsupported_event_type',
      type: 'issue.foo',
    });
  });

  // WP-989: 반복 회차 이벤트 — 스키마를 통과하면 202 로 받고 runRecurring 으로 보낸다(runAgent 아님).
  const recurringPayload = {
    ...validCreatedPayload,
    ownerUserId: 7,
    runId: '42-1790000000',
    runAt: '2026-09-21T23:13:20+09:00',
    round: 3,
    recurrence: { rrule: 'FREQ=DAILY', time: '23:13' },
    issueBody: '오늘 할 일을 정리해 줘',
  };

  it('issue.recurring_run → 202 + runRecurring(payload)', async () => {
    vi.mocked(runRecurring).mockClear();
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.recurring_run', payload: recurringPayload });
    expect(res.status).toBe(202);
    expect(runRecurring).toHaveBeenCalledOnce();
    expect(vi.mocked(runRecurring).mock.calls[0][0]).toMatchObject({ runId: '42-1790000000', round: 3, issueBody: '오늘 할 일을 정리해 줘' });
    expect(runAgent).not.toHaveBeenCalled();
  });

  // WP-1313: 「지금 실행」(테스트 실행)은 따로의 종류로 받는다 — 허락된 쓰기가 실린 이어 처리 페이로드도 받는다.
  it('issue.recurring_test_run → 202 + runRecurring(payload, deps, {test:true})', async () => {
    vi.mocked(runRecurring).mockClear();
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({
        type: 'issue.recurring_test_run',
        payload: {
          ...recurringPayload,
          runId: '42-f9',
          followUp: { question: 'q', answer: 'a', permittedActions: [{ tool: 'send_mail', args: { subject: 's' } }] },
        },
      });
    expect(res.status).toBe(202);
    expect(runRecurring).toHaveBeenCalledOnce();
    expect(vi.mocked(runRecurring).mock.calls[0][0].followUp?.permittedActions).toEqual([{ tool: 'send_mail', args: { subject: 's' } }]);
    expect(vi.mocked(runRecurring).mock.calls[0][2]).toEqual({ test: true });
  });

  it('issue.recurring_run 의 issueBody 는 null 이어도 받는다', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.recurring_run', payload: { ...recurringPayload, issueBody: null } });
    expect(res.status).toBe(202);
  });

  // 소유자 대행이 필수 — 없으면 비서 신원으로 대신 돌리지 않고 거절한다(fail-closed).
  it('issue.recurring_run 의 ownerUserId 누락 → 400 invalid_payload', async () => {
    const { ownerUserId: _omit, ...noOwner } = recurringPayload;
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.recurring_run', payload: noOwner });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('issue.recurring_run 의 runId 누락 → 400 invalid_payload', async () => {
    const { runId: _omit, ...noRunId } = recurringPayload;
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.recurring_run', payload: noRunId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('issue.assigned payload 의 added 누락 → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({
        type: 'issue.assigned',
        payload: {
          ...validCreatedPayload,
          removed: [],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('issue.created 정상 → 202 + runAgent fire-and-forget 호출', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('WP-386: 공용 메모리가 실린 이벤트는 그 필드를 남긴 채 runAgent 로 넘긴다(모양 틀린 항목이 있어도 거절하지 않는다)', async () => {
    const sharedMemories = [{ space: '조직', content: 'x' }, 'bad'];
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: { ...validCreatedPayload, sharedMemories, sharedMemoryMoreCount: 0 } });
    expect(res.status).toBe(202);
    expect(vi.mocked(runAgent).mock.calls[0][0].payload).toEqual(expect.objectContaining({ sharedMemories, sharedMemoryMoreCount: 0 }));
  });

  it('WP-386: 공용 메모리 필드의 모양이 틀려도(배열 아님·음수 개수) 이슈·채팅 이벤트를 거절하지 않는다', async () => {
    const bad = { sharedMemories: 'x', sharedMemoryMoreCount: -1 };
    const issue = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: { ...validCreatedPayload, ...bad } });
    expect(issue.status).toBe(202);
    expect(runAgent).toHaveBeenCalledOnce();
    const chat = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'chat.message.posted', payload: { ...validChatPayload, ...bad } });
    expect(chat.status).toBe(202);
    expect(handleChatEvent).toHaveBeenCalledOnce();
  });

  it('runAgent 가 느려도 즉시 202 응답', async () => {
    let resolveAgent: (() => void) | null = null;
    vi.mocked(runAgent).mockReturnValueOnce(
      new Promise<void>((r) => {
        resolveAgent = r;
      }),
    );
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'issue.created', payload: validCreatedPayload });
    expect(res.status).toBe(202);
    // 응답 후에야 resolve
    if (resolveAgent) (resolveAgent as () => void)();
  });

  const validChatPayload = {
    projectKey: 'WP',
    issueKey: 'WP-1',
    issueId: 1,
    threadId: 5,
    messageId: 9,
    actor: { id: 7, username: 'alice', name: 'Alice', kind: 'HUMAN' },
    body: '@AI 요약해줘',
    mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
    occurredAt: '2026-05-30T12:00:00Z',
    actingAgentId: 201,
  };

  it('chat.message.posted 정상 → 202 + handleChatEvent 호출', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'chat.message.posted', payload: validChatPayload });
    expect(res.status).toBe(202);
    expect(handleChatEvent).toHaveBeenCalledOnce();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('chat.message.posted actingAgentId 누락 → 400 invalid_payload (fail-closed, WP-371)', async () => {
    const { actingAgentId: _omit, ...noActing } = validChatPayload;
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'chat.message.posted', payload: noActing });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(handleChatEvent).not.toHaveBeenCalled();
  });

  it('chat.message.posted 잘못된 payload → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'chat.message.posted', payload: { threadId: 'nope' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(handleChatEvent).not.toHaveBeenCalled();
  });

  const validMessagingPayload = {
    channelId: 10,
    channelKind: 'PUBLIC',
    messageId: 55,
    respondAsAgentId: 201,
    actor: { id: 7, name: 'Alice', kind: 'HUMAN' },
    body: '@AI 도움말',
    mentions: [{ id: 201, username: 'ai-bot', name: 'AI', kind: 'AGENT' }],
    occurredAt: '2026-06-03T09:00:00Z',
  };

  it('messaging.message.posted 정상 → 202 + handleMessagingEvent 호출', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'messaging.message.posted', payload: validMessagingPayload });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });
    expect(handleMessagingEvent).toHaveBeenCalledOnce();
    expect(runAgent).not.toHaveBeenCalled();
    expect(handleChatEvent).not.toHaveBeenCalled();
  });

  it('messaging.message.posted 잘못된 payload → 400 invalid_payload', async () => {
    const res = await request(buildApp())
      .post('/events')
      .set('Authorization', AUTH)
      .send({ type: 'messaging.message.posted', payload: { channelId: 'bad' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(handleMessagingEvent).not.toHaveBeenCalled();
  });

  // WP-1828: AI 처리 기록 범위 — 이벤트마다 범위를 열고 처리 promise 결과로 닫는다.
  describe('AI 처리 기록 범위', () => {
    const recurring = {
      ...validCreatedPayload,
      ownerUserId: 5,
      tenantId: 77,
      runId: 'run-1',
      runAt: '2026-05-25T09:00:00+09:00',
      recurrence: { rrule: 'FREQ=DAILY', time: '09:00' },
    };

    /** 러너 호출을 흉내 — 현재 범위에 시작·종료를 알린다. */
    function fakeRunner() {
      const s = currentAiRunScope()!;
      s.runnerStarted('m', 'anthropic');
      s.runnerFinished({ ok: true, usage: { inputTokens: 1, outputTokens: 1 } });
    }

    function collect() {
      const records: AiRunRecord[] = [];
      return { records, sink: { enqueue: (r: AiRunRecord) => records.push(r) } };
    }

    it('issue.assigned 는 ISSUE_AGENT_RUN 범위로 처리되고 X-AI-Run 의 tenantId·issue 대상·actor 가 레코드에 실린다', async () => {
      const { records, sink } = collect();
      vi.mocked(runAgent).mockImplementation(async () => fakeRunner());
      const res = await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 9, runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b' }))
        .send({ type: 'issue.assigned', payload: { ...validCreatedPayload, added: [], removed: [] } });
      expect(res.status).toBe(202);
      await vi.waitFor(() => expect(records.map((r) => r.status)).toEqual(['RUNNING', 'SUCCEEDED']));
      expect(records[1]).toMatchObject({
        kind: 'ISSUE_AGENT_RUN', tenantId: 9, runId: '3f2b8c1e-5a4d-4e8f-9b7a-1c2d3e4f5a6b', targetType: 'ISSUE', targetId: '42',
        targetLabel: 'WP-42', actorType: 'USER', actorId: 7, sourceAt: '2026-05-25T12:00:00.000Z',
      });
    });

    it('occurredAt 을 읽을 수 없으면 sourceAt 은 null 이고 처리는 그대로 202', async () => {
      const { records, sink } = collect();
      vi.mocked(runAgent).mockImplementation(async () => fakeRunner());
      const res = await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 9 }))
        .send({ type: 'issue.assigned', payload: { ...validCreatedPayload, occurredAt: 'not-a-date', added: [], removed: [] } });
      expect(res.status).toBe(202);
      await vi.waitFor(() => expect(records).toHaveLength(2));
      expect(records[1].sourceAt).toBeNull();
    });

    it('X-AI-Run 을 읽을 수 없으면 경고 한 줄을 남기고 처리한다', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const { records, sink } = collect();
        vi.mocked(runAgent).mockImplementation(async () => fakeRunner());
        await request(buildApp(sink))
          .post('/events')
          .set('Authorization', AUTH)
          .set('X-AI-Run', '%%%')
          .send({ type: 'issue.assigned', payload: { ...validCreatedPayload, added: [], removed: [] } });
        await vi.waitFor(() => expect(records).toHaveLength(2));
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('issue.recurring_run 은 payload.tenantId·AUTO·runAt', async () => {
      const { records, sink } = collect();
      vi.mocked(runRecurring).mockImplementation(async () => fakeRunner());
      await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .send({ type: 'issue.recurring_run', payload: recurring });
      await vi.waitFor(() => expect(records).toHaveLength(2));
      expect(records[1]).toMatchObject({
        kind: 'RECURRING_RUN', tenantId: 77, actorType: 'AUTO', actorId: 5,
        sourceAt: '2026-05-25T00:00:00.000Z', targetId: '42',
      });
    });

    it('issue.recurring_run 은 헤더 tenantId 와 payload tenantId 가 다르면 payload 값을 기록한다', async () => {
      const { records, sink } = collect();
      vi.mocked(runRecurring).mockImplementation(async () => fakeRunner());
      await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 9 }))
        .send({ type: 'issue.recurring_run', payload: recurring });
      await vi.waitFor(() => expect(records).toHaveLength(2));
      expect(records[1].tenantId).toBe(77);
    });

    it('payload 에 tenantId 가 없으면 헤더 tenantId 를 쓴다', async () => {
      const { records, sink } = collect();
      vi.mocked(runAgent).mockImplementation(async () => fakeRunner());
      await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 9 }))
        .send({ type: 'issue.assigned', payload: { ...validCreatedPayload, added: [], removed: [] } });
      await vi.waitFor(() => expect(records).toHaveLength(2));
      expect(records[1].tenantId).toBe(9);
    });

    it('messaging.message.posted 는 CHANNEL 대상', async () => {
      const { records, sink } = collect();
      vi.mocked(handleMessagingEvent).mockImplementation(() => {
        fakeRunner();
        return Promise.resolve();
      });
      await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 3 }))
        .send({
          type: 'messaging.message.posted',
          payload: {
            channelId: 12, channelKind: 'CHANNEL', messageId: 1, respondAsAgentId: 9,
            actor: { id: 4, kind: 'AGENT' }, body: 'hi', mentions: [], occurredAt: '2026-05-25T12:00:00Z',
          },
        });
      await vi.waitFor(() => expect(records).toHaveLength(2));
      expect(records[1]).toMatchObject({
        kind: 'MESSAGING_REPLY', targetType: 'CHANNEL', targetId: '12', targetLabel: null,
        actorType: 'AGENT', actorId: 4, tenantId: 3,
      });
    });

    it('chat.message.posted 는 ISSUE_CHAT_REPLY 범위, ISSUE 대상', async () => {
      const { records, sink } = collect();
      vi.mocked(handleChatEvent).mockImplementation(() => {
        fakeRunner();
        return Promise.resolve();
      });
      await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 5 }))
        .send({ type: 'chat.message.posted', payload: validChatPayload });
      await vi.waitFor(() => expect(records).toHaveLength(2));
      expect(records[1]).toMatchObject({
        kind: 'ISSUE_CHAT_REPLY', tenantId: 5, targetType: 'ISSUE', targetId: String(validChatPayload.issueId),
        targetLabel: validChatPayload.issueKey, actorType: 'USER',
      });
    });

    it('잘못된 payload(400)는 범위를 열지 않는다', async () => {
      const { records, sink } = collect();
      const res = await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .send({ type: 'issue.created', payload: { projectKey: 'WP' } });
      expect(res.status).toBe(400);
      expect(records).toEqual([]);
    });

    it('처리 promise 가 reject 해도 202 응답은 같고 FAILED·handler_error', async () => {
      const { records, sink } = collect();
      vi.mocked(runAgent).mockImplementation(async () => {
        fakeRunner();
        throw new Error('실행 실패');
      });
      const res = await request(buildApp(sink))
        .post('/events')
        .set('Authorization', AUTH)
        .set('X-AI-Run', encodeAiRunHeader({ tenantId: 9 }))
        .send({ type: 'issue.created', payload: validCreatedPayload });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ received: true });
      await vi.waitFor(() => expect(records.map((r) => r.status)).toEqual(['RUNNING', 'FAILED']));
      expect(records[1].errorReason).toBe('handler_error');
      expect(records[1].errorDetail).toContain('실행 실패');
    });
  });
});
