// drive 라우트 테스트 — invalid payload→400, valid→200 {summary}, 러너 실패→502
// /drive/overview: 스키마 위반→400, SSE 헤더 확인, 스트리밍 delta 발행 확인.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-drive-ai.js', () => ({
  runDriveSummarize: vi.fn(),
  runDriveOverview: vi.fn(),
}));

import { createDriveRouter } from './drive.js';
import { runDriveSummarize, runDriveOverview } from '../agent/run-drive-ai.js';

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

describe('POST /drive/overview', () => {
  const validOverview = {
    query: '프로젝트 일정은?',
    excerpts: [{ name: 'plan.pdf', text: '2024년 1분기 완료 예정' }],
    assistantAgentId: 7,
  };

  it('query 누락 시 400', async () => {
    const res = await request(app()).post('/drive/overview').send({ excerpts: [] });
    expect(res.status).toBe(400);
  });

  it('excerpts 누락 시 400', async () => {
    const res = await request(app()).post('/drive/overview').send({ query: '질문' });
    expect(res.status).toBe(400);
  });

  it('SSE 헤더 + event:done 정상 스트리밍', async () => {
    // runDriveOverview 가 onText 를 1회 호출 후 resolve
    vi.mocked(runDriveOverview).mockImplementation(async (_input, _deps, onText) => {
      onText('프로젝트 일정은 1분기입니다.');
    });
    const res = await request(app()).post('/drive/overview').send(validOverview);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: delta');
    expect(res.text).toContain('프로젝트 일정은 1분기입니다.');
    expect(res.text).toContain('event: done');
  });

  it('러너 실패 시 event:error 발행', async () => {
    vi.mocked(runDriveOverview).mockRejectedValue(new Error('llm fail'));
    const res = await request(app()).post('/drive/overview').send(validOverview);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('event: error');
  });
});
