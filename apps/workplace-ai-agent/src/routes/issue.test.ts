// 이슈 AI 라우트 테스트 — 현황 요약 400/200/502 + body·chat 패스스루(스키마 strip 회귀 가드).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-issue-summary.js', () => ({
  runIssueProgressSummary: vi.fn(),
}));

vi.mock('../agent/run-work-profile.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/run-work-profile.js')>()),
  runWorkProfile: vi.fn(),
}));

vi.mock('../agent/run-project-status.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/run-project-status.js')>()),
  runProjectStatus: vi.fn(),
}));

vi.mock('../agent/run-project-report.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agent/run-project-report.js')>()),
  runProjectReport: vi.fn(),
}));

import { runWorkProfile } from '../agent/run-work-profile.js';
import { runProjectStatus } from '../agent/run-project-status.js';
import { runProjectReport } from '../agent/run-project-report.js';
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

  // WP-869: 상태 이름(statusName)은 strip 되지 않고 러너까지 간다. 구 API(statusName 없음)·null 도 200.
  it('statusName 이 러너로 전달된다', async () => {
    vi.mocked(runIssueProgressSummary).mockResolvedValue({ summary: 's', nextAction: '' });
    const res = await request(app()).post('/issue/progress-summary').send({ ...valid, statusName: '검토 중' });
    expect(res.status).toBe(200);
    expect(vi.mocked(runIssueProgressSummary).mock.calls[0][0].statusName).toBe('검토 중');
  });

  it('issue summary route: statusName 없는 구 payload 도 200', async () => {
    vi.mocked(runIssueProgressSummary).mockResolvedValue({ summary: 's', nextAction: '' });
    expect((await request(app()).post('/issue/progress-summary').send(valid)).status).toBe(200);
    expect((await request(app()).post('/issue/progress-summary').send({ ...valid, statusName: null })).status).toBe(200);
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

// WP-1485: 업무 프로파일 — 200 패스스루 / 101건 400 / 러너 실패 502.
describe('POST /issue/work-profile', () => {
  const issue = { key: 'WP-1', title: '제목', project: 'WP', dueResult: '기한 내' };
  const valid = {
    periodLabel: '이번 달',
    issues: [issue],
    assistantAgentId: 3,
    model: 'm',
    maxTurns: 8,
    timeoutMs: 60000,
  };

  it('정상 200 + 본문 패스스루', async () => {
    const result = { summary: '요약', skills: ['a'], items: [{ key: 'WP-1', task: '기타', area: '' }] };
    vi.mocked(runWorkProfile).mockResolvedValue(result);
    const res = await request(app()).post('/issue/work-profile').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
  });

  it('issues 101건이면 400 invalid_payload', async () => {
    const issues = Array.from({ length: 101 }, (_, i) => ({ ...issue, key: `WP-${i}` }));
    const res = await request(app()).post('/issue/work-profile').send({ ...valid, issues });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('러너 실패 502 work_profile_failed', async () => {
    vi.mocked(runWorkProfile).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/issue/work-profile').send(valid);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'work_profile_failed' });
  });
});

// WP-1479: 프로젝트 상태 요약 — 200 패스스루 / 필드 누락 400 / 러너 실패 502.
describe('POST /issue/project-status', () => {
  const valid = {
    projectName: 'WP',
    badge: 'ON_TRACK',
    inputs: {
      completedRecent: 1, completedPrevious: 0, createdRecent: 2, createdPrevious: 1,
      dueSoon: 0, dueSoonUnassigned: 0, overdue: 0, overdueOldestDays: null,
      stale: 0, waiting: 0, openTotal: 3, openTodo: 2, openInProgress: 1, openUnassigned: 0,
      progressKind: 'TREND', progressName: null, progressEnd: null, progressDone: null,
      progressTotal: 3, projectedDate: null, lateDays: null, trendDelta: -1,
    },
    assistantAgentId: 3,
    model: 'm',
    maxTurns: 8,
    timeoutMs: 60000,
  };

  it('정상 200 + 본문 패스스루', async () => {
    vi.mocked(runProjectStatus).mockResolvedValue({ summary: '요약' });
    const res = await request(app()).post('/issue/project-status').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: '요약' });
  });

  it('inputs 가 빠지면 400 invalid_payload', async () => {
    const { inputs: _inputs, ...rest } = valid;
    const res = await request(app()).post('/issue/project-status').send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(runProjectStatus).not.toHaveBeenCalled();
  });

  it('러너 실패 502 project_status_failed', async () => {
    vi.mocked(runProjectStatus).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/issue/project-status').send(valid);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'project_status_failed' });
  });
});

// WP-1483: 프로젝트 리포트 — 200 패스스루 / 필드 누락 400 / 러너 실패 502.
describe('POST /issue/project-report', () => {
  const valid = {
    projectName: 'WP',
    title: '11월 2주차 주간 리포트',
    periodLabel: '11월 9일 ~ 15일',
    cadenceLabel: '주간',
    templateMarkdown: '## 샘플',
    badge: 'ON_TRACK',
    tableRows: [{ label: '완료', current: '1', change: '+1' }],
    issues: [],
    assistantAgentId: 3,
    model: 'm',
    maxTurns: 8,
    timeoutMs: 60000,
  };

  it('projectReport_success_200', async () => {
    vi.mocked(runProjectReport).mockResolvedValue({ markdown: '## 본문' });
    const res = await request(app()).post('/issue/project-report').send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ markdown: '## 본문' });
  });

  it('projectReport_invalidPayload_400', async () => {
    const { templateMarkdown: _t, ...rest } = valid;
    const res = await request(app()).post('/issue/project-report').send(rest);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(runProjectReport).not.toHaveBeenCalled();
  });

  it('projectReport_runnerThrows_502', async () => {
    vi.mocked(runProjectReport).mockRejectedValue(new Error('boom'));
    const res = await request(app()).post('/issue/project-report').send(valid);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'project_report_failed' });
  });
});
