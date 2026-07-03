import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-wiki-compose.js', () => ({
  runWikiCompose: vi.fn(),
}));

import { createWikiRouter, wikiComposeSchema } from './wiki.js';
import { runWikiCompose } from '../agent/run-wiki-compose.js';

// 유효 페이로드(요청 본문 계약).
function validBody(over: Record<string, unknown> = {}) {
  return {
    action: 'summarize',
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
      expect.objectContaining({ action: 'summarize', assistantAgentId: 7 }),
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
