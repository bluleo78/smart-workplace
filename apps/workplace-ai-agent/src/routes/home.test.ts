import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-ai-compose.js', () => ({
  runAiComposeStream: vi.fn(),
}));

const logMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ log: logMock }));

import { createHomeRouter, composeSchema } from './home.js';
import { runAiComposeStream } from '../agent/run-ai-compose.js';

// 비서 필드를 포함한 유효 페이로드(요청 본문 계약).
function validBody(over: Record<string, unknown> = {}) {
  return {
    query: '내 할 일',
    assistantAgentId: 7,
    // #376: userId — MCP 도구 컨텍스트를 요청자로 설정하기 위해 필수 필드로 추가.
    userId: 1,
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

  // #430: 공백 전용 쿼리는 trim 후 min(1) 에서 거부돼야 한다.
  it('공백 전용 쿼리("   ") → 파싱 실패', () => {
    expect(composeSchema.safeParse(validBody({ query: '   ' })).success).toBe(false);
  });

  it('thinkingDepth 가 enum 밖이면 파싱 실패', () => {
    expect(composeSchema.safeParse(validBody({ thinkingDepth: 'WAT' })).success).toBe(false);
  });

  // #376: userId 필수 필드 검증.
  it('userId 누락 → 파싱 실패', () => {
    const { userId: _omit, ...rest } = validBody();
    void _omit;
    expect(composeSchema.safeParse(rest).success).toBe(false);
  });
});

describe('POST /ai/compose', () => {
  it('델타 2개 → event: delta 2개 + event: done 발행', async () => {
    // 러너가 onText 를 2회 호출(점진 write) 후 정상 종료. done에 fullText + widgets 포함.
    vi.mocked(runAiComposeStream).mockImplementation(async (_i, _d, onText) => {
      onText('안');
      onText('녕');
      return { fullText: '안녕', widgets: null, pendingActions: [], usage: { inputTokens: 100, outputTokens: 20 } };
    });
    const res = await request(buildApp()).post('/ai/compose').send(validBody());
    expect(res.status).toBe(200);
    // 점진 write: supertest 는 전체 본문을 모으므로 청크 분리(2개 delta)를 검증한다.
    const deltas = res.text.match(/event: delta\n/g) ?? [];
    expect(deltas).toHaveLength(2);
    expect(res.text).toContain('data: {"text":"안"}');
    expect(res.text).toContain('data: {"text":"녕"}');
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"fullText":"안녕"');
    // #432: done 이벤트에 usage(토큰 사용량) 포함.
    expect(res.text).toContain('"usage":{"inputTokens":100,"outputTokens":20}');
    // 러너에 파싱된 페이로드가 그대로 전달됐는지 회귀 가드(5번째 onProgress, 6번째 onTool 인자 포함).
    expect(runAiComposeStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일', assistantAgentId: 7 }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('query 누락(빈 문자열) → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/ai/compose').send(validBody({ query: '' }));
    expect(res.status).toBe(400);
    expect(runAiComposeStream).not.toHaveBeenCalled();
  });

  // #430: 공백 전용 쿼리는 trim 후 비어 있으므로 400 을 반환해야 한다.
  it('공백 전용 쿼리("   ") → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/ai/compose').send(validBody({ query: '   ' }));
    expect(res.status).toBe(400);
    expect(runAiComposeStream).not.toHaveBeenCalled();
  });

  it('비서 필드 누락 → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/ai/compose').send({ query: 'x' });
    expect(res.status).toBe(400);
    expect(runAiComposeStream).not.toHaveBeenCalled();
  });

  it('러너 오류 → event: error 발행', async () => {
    vi.mocked(runAiComposeStream).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/ai/compose').send(validBody());
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('compose_failed');
  });

  it('pendingActions 가 있으면 event: pending_action 을 done 앞에 배열로 발행', async () => {
    // #351: propose 도구가 사이드카에 제안을 쓴 경우 — 라우트가 done 앞에 pending_action(배열) 발행.
    vi.mocked(runAiComposeStream).mockResolvedValue({ fullText: '제안했어요', widgets: null, pendingActions: [{ actionType: 'calendar.create_event', summary: 's', params: {} }], usage: null });
    const res = await request(buildApp()).post('/ai/compose').send(validBody());
    expect(res.text).toContain('event: pending_action');
    expect(res.text).toContain('"actionType":"calendar.create_event"');
    // 순서: pending_action 인덱스 < done 인덱스
    expect(res.text.indexOf('event: pending_action')).toBeLessThan(res.text.indexOf('event: done'));
  });

  it('위임 진행(onProgress) → event: progress 발행', async () => {
    // 러너가 onProgress 를 호출(위임 라벨) 후 정상 종료하도록 mock.
    // 라우트가 5번째 인자로 onProgress 콜백을 전달하고 event: progress 로 직렬화하는지 검증.
    vi.mocked(runAiComposeStream).mockImplementation(async (_i, _d, _onText, _signal, onProgress) => {
      onProgress?.('이슈 전문가에게 위임 중');
      return { fullText: '처리했어요.', widgets: null, pendingActions: [], usage: null };
    });
    const res = await request(buildApp()).post('/ai/compose').send(validBody());
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('"label":"이슈 전문가에게 위임 중"');
    // 라우트가 onProgress(5번째 인자), onTool(6번째 인자)를 함수로 전달했는지 회귀 가드.
    expect(runAiComposeStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일' }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
    );
  });
});

describe('/ai/compose 로그', () => {
  beforeEach(() => {
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  it('요청 시작 시 start 로그를 requestId·query 와 함께 발행한다', async () => {
    vi.mocked(runAiComposeStream).mockImplementation(async (_input, _deps, onText) => {
      onText('답변');
      return { fullText: '답변', widgets: null, pendingActions: [], usage: null };
    });
    await request(buildApp()).post('/ai/compose').send(validBody({ query: '내 현황' }));
    const startCall = logMock.info.mock.calls.find((c) => c[1] === 'start');
    expect(startCall).toBeTruthy();
    expect(startCall![2]).toMatchObject({ query: expect.stringContaining('내 현황'), agentId: 7 });
    expect(typeof startCall![2].requestId).toBe('string');
  });

  it('동일 requestId 가 start 와 done 에 함께 찍힌다', async () => {
    vi.mocked(runAiComposeStream).mockImplementation(async (_input, _deps, onText) => {
      onText('답변');
      return { fullText: '답변', widgets: null, pendingActions: [], usage: null };
    });
    await request(buildApp()).post('/ai/compose').send(validBody());
    const start = logMock.info.mock.calls.find((c) => c[1] === 'start');
    const done = logMock.info.mock.calls.find((c) => c[1] === 'done');
    expect(start![2].requestId).toBe(done![2].requestId);
  });
});
