// 7d: 메일 AI 라우트 테스트 — classify/summarize/reply-draft 400/200/502 검증.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-mail-ai.js', () => ({
  runMailClassify: vi.fn(),
  runMailSummarize: vi.fn(),
  runMailReplyDraft: vi.fn(),
  runMailDraftCoaching: vi.fn(),
  runMailIssueDraft: vi.fn(),
}));

import { createMailRouter } from './mail.js';
import { runMailClassify, runMailSummarize, runMailReplyDraft, runMailDraftCoaching } from '../agent/run-mail-ai.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(createMailRouter({ client: {} as never }));
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /mail/classify', () => {
  const valid = { subject: 's', from: 'a@b', snippet: 'x', assistantAgentId: 7, model: 'm', maxTurns: 1, timeoutMs: 60000 };
  it('정상 200 + 결과', async () => {
    vi.mocked(runMailClassify).mockResolvedValue({ category: '업무', needsReply: true });
    const res = await request(app()).post('/mail/classify').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ category: '업무', needsReply: true });
  });
  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/mail/classify').send({ subject: 's' });
    expect(res.status).toBe(400);
  });
  it('러너 실패 502', async () => {
    vi.mocked(runMailClassify).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/mail/classify').send(valid);
    expect(res.status).toBe(502);
  });
});

describe('POST /mail/summarize', () => {
  const valid = { subject: 's', from: 'a@b', body: 'body text', assistantAgentId: 7, model: 'm', maxTurns: 1, timeoutMs: 60000 };
  it('정상 200 + 결과', async () => {
    vi.mocked(runMailSummarize).mockResolvedValue({ summary: '요약 내용' });
    const res = await request(app()).post('/mail/summarize').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: '요약 내용' });
  });
  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/mail/summarize').send({ subject: 's' });
    expect(res.status).toBe(400);
  });
  it('러너 실패 502', async () => {
    vi.mocked(runMailSummarize).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/mail/summarize').send(valid);
    expect(res.status).toBe(502);
  });
});

describe('POST /mail/reply-draft', () => {
  const valid = {
    thread: [{ from: 'a@b', date: '2024-01-01', body: 'hello' }],
    replyingAs: 'me@example.com',
    assistantAgentId: 7,
    model: 'm',
    maxTurns: 1,
    timeoutMs: 60000,
  };
  it('정상 200 + 결과', async () => {
    vi.mocked(runMailReplyDraft).mockResolvedValue({ draftBody: '답장 초안' });
    const res = await request(app()).post('/mail/reply-draft').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ draftBody: '답장 초안' });
  });
  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/mail/reply-draft').send({ replyingAs: 'me@example.com' });
    expect(res.status).toBe(400);
  });
  it('러너 실패 502', async () => {
    vi.mocked(runMailReplyDraft).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/mail/reply-draft').send(valid);
    expect(res.status).toBe(502);
  });
});

describe('POST /mail/draft-coaching', () => {
  const valid = {
    draftBody: '빨리 보내',
    thread: [],
    replyingAs: 'me@example.com',
    assistantAgentId: 7,
    model: 'm',
    maxTurns: 1,
    timeoutMs: 60000,
  };
  it('정상 200 + 결과', async () => {
    vi.mocked(runMailDraftCoaching).mockResolvedValue({
      notes: [{ dimension: 'TONE', message: '명령조' }],
      improvedBodyHtml: '<p>개선</p>',
    });
    const res = await request(app()).post('/mail/draft-coaching').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ notes: [{ dimension: 'TONE', message: '명령조' }], improvedBodyHtml: '<p>개선</p>' });
  });
  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/mail/draft-coaching').send({ draftBody: 'x' });
    expect(res.status).toBe(400);
  });
  it('러너 실패 502', async () => {
    vi.mocked(runMailDraftCoaching).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/mail/draft-coaching').send(valid);
    expect(res.status).toBe(502);
  });
});
