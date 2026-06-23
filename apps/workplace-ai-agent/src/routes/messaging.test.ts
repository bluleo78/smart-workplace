// 메시징 AI 라우트 테스트 — classify 400/200/502 검증. mail.test.ts 미러.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-messaging-ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../agent/run-messaging-ai.js')>();
  return { ...actual, runMessagingClassify: vi.fn() };
});

import { createMessagingRouter } from './messaging.js';
import { runMessagingClassify } from '../agent/run-messaging-ai.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(createMessagingRouter({ client: {} as never }));
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /messaging/classify', () => {
  const valid = {
    messages: [{ authorName: '김PM', body: '동희가 배포했나?' }],
    members: [{ userId: 1, displayName: '양동희' }],
    assistantAgentId: 7,
    model: 'claude-haiku-4-5-20251001',
    maxTurns: 4,
    timeoutMs: 30000,
  };

  it('정상 200 + relevant', async () => {
    vi.mocked(runMessagingClassify).mockResolvedValue({ relevant: [{ userId: 1, reason: '이름 직접 언급' }] });
    const res = await request(app()).post('/messaging/classify').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ relevant: [{ userId: 1, reason: '이름 직접 언급' }] });
  });

  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/messaging/classify').send({});
    expect(res.status).toBe(400);
  });

  it('러너 실패 502', async () => {
    vi.mocked(runMessagingClassify).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/messaging/classify').send(valid);
    expect(res.status).toBe(502);
  });
});
