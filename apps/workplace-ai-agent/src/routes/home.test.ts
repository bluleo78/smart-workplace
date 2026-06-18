import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-home-compose.js', () => ({
  runHomeCompose: vi.fn(),
  runHomeComposeStream: vi.fn(),
}));

import { createHomeRouter, composeSchema } from './home.js';
import { runHomeComposeStream } from '../agent/run-home-compose.js';

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
  it('델타 2개 → event: delta 2개 + event: done 발행', async () => {
    // 러너가 onText 를 2회 호출(점진 write) 후 정상 종료. done에 fullText + widgets 포함.
    vi.mocked(runHomeComposeStream).mockImplementation(async (_i, _d, onText) => {
      onText('안');
      onText('녕');
      return { fullText: '안녕', widgets: null, pendingAction: null };
    });
    const res = await request(buildApp()).post('/home/compose').send(validBody());
    expect(res.status).toBe(200);
    // 점진 write: supertest 는 전체 본문을 모으므로 청크 분리(2개 delta)를 검증한다.
    const deltas = res.text.match(/event: delta\n/g) ?? [];
    expect(deltas).toHaveLength(2);
    expect(res.text).toContain('data: {"text":"안"}');
    expect(res.text).toContain('data: {"text":"녕"}');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"fullText":"안녕"');
    // 러너에 파싱된 페이로드가 그대로 전달됐는지 회귀 가드(5번째 onProgress 인자 포함).
    expect(runHomeComposeStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일', assistantAgentId: 7 }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('query 누락 → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/home/compose').send(validBody({ query: '' }));
    expect(res.status).toBe(400);
    expect(runHomeComposeStream).not.toHaveBeenCalled();
  });

  it('비서 필드 누락 → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/home/compose').send({ query: 'x' });
    expect(res.status).toBe(400);
    expect(runHomeComposeStream).not.toHaveBeenCalled();
  });

  it('러너 오류 → event: error 발행', async () => {
    vi.mocked(runHomeComposeStream).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/home/compose').send(validBody());
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('compose_failed');
  });

  it('pendingAction 이 있으면 event: pending_action 을 done 앞에 발행', async () => {
    // #333 M2: propose 도구가 사이드카에 제안을 쓴 경우 — 라우트가 done 앞에 pending_action 발행.
    vi.mocked(runHomeComposeStream).mockResolvedValue({ fullText: '제안했어요', widgets: null, pendingAction: { actionType: 'calendar.create_event', summary: 's', params: {} } });
    const res = await request(buildApp()).post('/home/compose').send(validBody());
    expect(res.text).toContain('event: pending_action');
    expect(res.text).toContain('"actionType":"calendar.create_event"');
    // 순서: pending_action 인덱스 < done 인덱스
    expect(res.text.indexOf('event: pending_action')).toBeLessThan(res.text.indexOf('event: done'));
  });

  it('위임 진행(onProgress) → event: progress 발행', async () => {
    // 러너가 onProgress 를 호출(위임 라벨) 후 정상 종료하도록 mock.
    // 라우트가 5번째 인자로 onProgress 콜백을 전달하고 event: progress 로 직렬화하는지 검증.
    vi.mocked(runHomeComposeStream).mockImplementation(async (_i, _d, _onText, _signal, onProgress) => {
      onProgress?.('이슈 전문가에게 위임 중');
      return { fullText: '처리했어요.', widgets: null, pendingAction: null };
    });
    const res = await request(buildApp()).post('/home/compose').send(validBody());
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('"label":"이슈 전문가에게 위임 중"');
    // 라우트가 onProgress(5번째 인자)를 함수로 전달했는지 회귀 가드.
    expect(runHomeComposeStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일' }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });
});
