// 이슈 AI 라우트 테스트 — 현황 요약 400/200/502 + body·chat 패스스루(스키마 strip 회귀 가드).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-issue-summary.js', () => ({
  runIssueProgressSummary: vi.fn(),
}));

import { createIssueRouter } from './issue.js';
import { runIssueProgressSummary } from '../agent/run-issue-summary.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(createIssueRouter({ client: {} as never }));
  return a;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /issue/progress-summary', () => {
  const valid = {
    title: '제목',
    status: 'IN_PROGRESS',
    priority: 'MID',
    dueDate: null,
    comments: [{ authorName: '동희', body: '코멘트', createdAt: '2026-06-28T00:00:00Z' }],
    history: [],
    assistantAgentId: 3,
    model: 'm',
    maxTurns: 8,
    timeoutMs: 60000,
  };

  it('정상 200 + 결과', async () => {
    vi.mocked(runIssueProgressSummary).mockResolvedValue({ summary: '현황', nextAction: '다음' });
    const res = await request(app()).post('/issue/progress-summary').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: '현황', nextAction: '다음' });
  });

  it('스키마 위반 400', async () => {
    const res = await request(app()).post('/issue/progress-summary').send({ title: '제목' });
    expect(res.status).toBe(400);
  });

  it('러너 실패 502', async () => {
    vi.mocked(runIssueProgressSummary).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/issue/progress-summary').send(valid);
    expect(res.status).toBe(502);
  });

  // 회귀 가드: zod 기본 strip 이 body·chat 을 떨구지 않고 러너까지 전달되어야 한다.
  it('body·chat 이 러너로 전달된다(strip 안 됨)', async () => {
    vi.mocked(runIssueProgressSummary).mockResolvedValue({ summary: 's', nextAction: '' });
    const payload = {
      ...valid,
      body: '이슈 본문 설명',
      chat: [
        { author: '동희', kind: 'USER', body: '진행 어때요?', createdAt: '2026-06-28T01:00:00Z' },
        { author: 'AI', kind: 'AGENT', body: '리뷰 대기 중입니다', createdAt: null },
      ],
    };
    const res = await request(app()).post('/issue/progress-summary').send(payload);
    expect(res.status).toBe(200);
    const arg = vi.mocked(runIssueProgressSummary).mock.calls[0][0];
    expect(arg.body).toBe('이슈 본문 설명');
    expect(arg.chat).toHaveLength(2);
    expect(arg.chat?.[1]).toMatchObject({ author: 'AI', kind: 'AGENT', body: '리뷰 대기 중입니다' });
  });

  // 회귀 가드: 본문 없는 이슈는 api 가 body:null 을 보낸다 — zod 가 거부(400)하지 않고 통과해야 한다.
  it('body 가 null 이어도 400 아님(본문 없는 이슈)', async () => {
    vi.mocked(runIssueProgressSummary).mockResolvedValue({ summary: 's', nextAction: '' });
    const res = await request(app())
      .post('/issue/progress-summary')
      .send({ ...valid, body: null });
    expect(res.status).toBe(200);
  });

  // body·chat 미제공 시 기본값(빈 문자열·빈 배열)으로 채워진다.
  it('body·chat 생략 시 기본값', async () => {
    vi.mocked(runIssueProgressSummary).mockResolvedValue({ summary: 's', nextAction: '' });
    await request(app()).post('/issue/progress-summary').send(valid);
    const arg = vi.mocked(runIssueProgressSummary).mock.calls[0][0];
    expect(arg.body).toBe('');
    expect(arg.chat).toEqual([]);
  });
});
