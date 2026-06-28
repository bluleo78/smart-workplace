// drive 라우트 테스트 — invalid payload→400, valid→200 {summary}, 러너 실패→502
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-drive-ai.js', () => ({
  runDriveSummarize: vi.fn(),
}));

import { createDriveRouter } from './drive.js';
import { runDriveSummarize } from '../agent/run-drive-ai.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(createDriveRouter({ client: {} as never }));
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /drive/summarize', () => {
  const valid = {
    text: '파일 본문 내용입니다.',
    fileName: 'report.pdf',
    mime: 'application/pdf',
    assistantAgentId: 7,
    model: 'claude-sonnet',
    maxTurns: 1,
    timeoutMs: 60000,
  };

  it('정상 200 + {summary}', async () => {
    vi.mocked(runDriveSummarize).mockResolvedValue({ summary: '파일 요약 결과' });
    const res = await request(app()).post('/drive/summarize').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: '파일 요약 결과' });
  });

  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/drive/summarize').send({ text: '내용만' });
    expect(res.status).toBe(400);
  });

  it('러너 실패 502', async () => {
    vi.mocked(runDriveSummarize).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/drive/summarize').send(valid);
    expect(res.status).toBe(502);
  });
});
