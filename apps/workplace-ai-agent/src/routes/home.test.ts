import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-home-compose.js', () => ({
  runHomeCompose: vi.fn(),
}));

import { createHomeRouter, composeSchema } from './home.js';
import { runHomeCompose } from '../agent/run-home-compose.js';

// 비서 필드를 포함한 유효 페이로드(요청 본문 계약).
function validBody(over: Record<string, unknown> = {}) {
  return {
    query: '내 할 일',
    assistantAgentId: 7,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'NORMAL',
    maxTurns: 8,
    timeoutMs: 60_000,
    ...over,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createHomeRouter({ client: {} as never }));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('composeSchema', () => {
  it('유효 페이로드는 파싱 성공', () => {
    expect(composeSchema.safeParse(validBody()).success).toBe(true);
  });

  it('신규 필수 비서 필드 누락 → 파싱 실패', () => {
    const { assistantAgentId: _omit, ...rest } = validBody();
    void _omit;
    expect(composeSchema.safeParse(rest).success).toBe(false);
  });

  it('thinkingDepth 가 enum 밖이면 파싱 실패', () => {
    expect(composeSchema.safeParse(validBody({ thinkingDepth: 'WAT' })).success).toBe(false);
  });
});

describe('POST /home/compose', () => {
  it('정상 → 200 + {message, widgets}', async () => {
    vi.mocked(runHomeCompose).mockResolvedValue({ message: 'ok', widgets: [{ type: 'my_tasks', params: {} }] });
    const res = await request(buildApp()).post('/home/compose').send(validBody());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'ok', widgets: [{ type: 'my_tasks', params: {} }] });
    expect(runHomeCompose).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일', assistantAgentId: 7, thinkingDepth: 'NORMAL' }),
      expect.anything(),
    );
  });

  it('query 누락 → 400', async () => {
    const res = await request(buildApp()).post('/home/compose').send(validBody({ query: '' }));
    expect(res.status).toBe(400);
    expect(runHomeCompose).not.toHaveBeenCalled();
  });

  it('비서 필드 누락 → 400', async () => {
    const res = await request(buildApp()).post('/home/compose').send({ query: 'x' });
    expect(res.status).toBe(400);
    expect(runHomeCompose).not.toHaveBeenCalled();
  });

  it('러너 오류 → 502', async () => {
    vi.mocked(runHomeCompose).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/home/compose').send(validBody());
    expect(res.status).toBe(502);
  });
});
