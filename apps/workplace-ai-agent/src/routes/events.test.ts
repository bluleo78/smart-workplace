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

const client = {
  addIssueComment: vi.fn(),
  unassignSelf: vi.fn(),
  getOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(internalAuth, createEventsRouter({ client }));
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
});
