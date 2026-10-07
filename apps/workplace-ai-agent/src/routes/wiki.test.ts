import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-wiki-compose.js', () => ({
  runWikiCompose: vi.fn(),
}));

vi.mock('../agent/run-wiki-summarize.js', () => ({
  runWikiSummarize: vi.fn(),
}));

import { createWikiRouter, wikiComposeSchema } from './wiki.js';
import { runWikiCompose } from '../agent/run-wiki-compose.js';
import { runWikiSummarize } from '../agent/run-wiki-summarize.js';

// 유효 페이로드(요청 본문 계약).
function validBody(over: Record<string, unknown> = {}) {
  return {
    action: 'continue',
    pageTitle: '온보딩 가이드',
    pageBody: '## 개요\n절차.',
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
  app.use(createWikiRouter({ client: {} as never }));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('wikiComposeSchema', () => {
  it('유효 페이로드는 파싱 성공', () => {
    expect(wikiComposeSchema.safeParse(validBody()).success).toBe(true);
  });

  it('action 이 enum 밖이면 파싱 실패', () => {
    expect(wikiComposeSchema.safeParse(validBody({ action: 'unknown_action' })).success).toBe(
      false
    );
  });

  it('비서 필드 누락 → 파싱 실패', () => {
    const { assistantAgentId: _omit, ...rest } = validBody();
    void _omit;
    expect(wikiComposeSchema.safeParse(rest).success).toBe(false);
  });
});

describe('POST /wiki/compose', () => {
  it('델타 2개 → event: delta 2개 + event: done 발행', async () => {
    // 러너가 onDelta 를 2회 호출(점진 write) 후 정상 종료.
    vi.mocked(runWikiCompose).mockImplementation(async (_input, _deps, onDelta) => {
      onDelta('요약: ');
      onDelta('핵심 내용');
    });
    const res = await request(buildApp()).post('/wiki/compose').send(validBody());
    expect(res.status).toBe(200);
    // 점진 write: supertest 는 전체 본문을 모으므로 타이밍이 아닌 청크 분리(2개 delta)를 검증한다.
    const deltas = res.text.match(/event: delta\n/g) ?? [];
    expect(deltas).toHaveLength(2);
    expect(res.text).toContain('data: {"text":"요약: "}');
    expect(res.text).toContain('data: {"text":"핵심 내용"}');
    expect(res.text).toContain('event: done\ndata: {}');
    // 러너에 파싱된 페이로드가 그대로 전달됐는지 회귀 가드.
    expect(runWikiCompose).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'continue', assistantAgentId: 7 }),
      expect.anything(),
      expect.any(Function),
      expect.anything(),
    );
  });

  it('잘못된 페이로드 → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/wiki/compose').send(validBody({ action: 'nope' }));
    expect(res.status).toBe(400);
    expect(runWikiCompose).not.toHaveBeenCalled();
  });

  it('러너 오류 → event: error 발행', async () => {
    vi.mocked(runWikiCompose).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/wiki/compose').send(validBody());
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('compose_failed');
  });
});

describe('wikiComposeSchema — WP-301', () => {
  it('summarize 액션은 제거되어 파싱 실패', () => {
    expect(wikiComposeSchema.safeParse(validBody({ action: 'summarize' })).success).toBe(false);
  });
});

// WP-301 노트 상단 요약 — 비스트리밍 단발.
describe('POST /wiki/summarize', () => {
  const body = {
    title: '주간회의',
    body: '## 결정\n배포 확정.',
    assistantAgentId: 7,
    model: 'claude-sonnet-4-6',
    maxTurns: 3,
    timeoutMs: 60_000,
  };

  it('러너 결과를 {summary} 로 반환', async () => {
    vi.mocked(runWikiSummarize).mockResolvedValue({ summary: '배포를 확정했다.' });
    const res = await request(buildApp()).post('/wiki/summarize').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: '배포를 확정했다.' });
    expect(runWikiSummarize).toHaveBeenCalledWith(expect.objectContaining({ title: '주간회의', assistantAgentId: 7 }), expect.anything());
  });

  it('필수 필드 누락 → 400, 러너 미호출', async () => {
    const { body: _b, ...rest } = body;
    void _b;
    const res = await request(buildApp()).post('/wiki/summarize').send(rest);
    expect(res.status).toBe(400);
    expect(runWikiSummarize).not.toHaveBeenCalled();
  });

  it('러너 실패 → 502', async () => {
    vi.mocked(runWikiSummarize).mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post('/wiki/summarize').send(body);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'wiki-summarize_failed' });
  });
});
