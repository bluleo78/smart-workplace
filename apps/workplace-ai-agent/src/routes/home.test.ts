import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../agent/run-ai-chat.js', () => ({
  runAiChatStream: vi.fn(),
}));

vi.mock('../agent/run-home-priority-classify.js', () => ({
  runHomePriorityClassify: vi.fn(),
}));

vi.mock('../agent/run-home-context-summary.js', async (orig) => ({
  ...(await orig<typeof import('../agent/run-home-context-summary.js')>()),
  runHomeContextSummary: vi.fn(),
}));

vi.mock('../agent/run-suggestions.js', async (orig) => ({
  ...(await orig<typeof import('../agent/run-suggestions.js')>()),
  runSuggestions: vi.fn(),
}));

const logMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ log: logMock }));

import { createHomeRouter, chatSchema } from './home.js';
import { JSON_BODY_LIMIT } from '../index-config.js';
import { runAiChatStream } from '../agent/run-ai-chat.js';
import { runHomePriorityClassify } from '../agent/run-home-priority-classify.js';
import { runHomeContextSummary } from '../agent/run-home-context-summary.js';
import { runSuggestions } from '../agent/run-suggestions.js';

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

describe('chatSchema', () => {
  // WP-55: 구 API(필드 없음)도 받는다 — memories 는 빈 배열, memoryEnabled 는 없음(러너가 꺼짐으로 다룬다).
  it('memories·memoryEnabled 생략·null 도 파싱 성공(memories 는 빈 배열)', () => {
    const parsed = chatSchema.parse(validBody());
    expect(parsed.memories).toEqual({ items: [], dropped: 0 });
    expect(parsed.memoryEnabled).toBeUndefined();
    expect(chatSchema.parse(validBody({ memories: null, memoryEnabled: null })).memories).toEqual({ items: [], dropped: 0 });
  });
  it('WP-379: app 은 알려진 앱이면 보존, 없으면 undefined, 모르는 값이면 null(채팅은 막지 않는다)', () => {
    expect(chatSchema.parse(validBody({ app: 'MAIL' })).app).toBe('MAIL');
    expect(chatSchema.parse(validBody()).app).toBeUndefined();
    expect(chatSchema.parse(validBody({ app: 'CONTACTS' })).app).toBeNull();
  });
  it('WP-380: today 는 yyyy-MM-dd 면 보존, 없으면 undefined, 틀리면 null(채팅은 막지 않는다) — 메모리 expiresOn 보존', () => {
    expect(chatSchema.parse(validBody({ today: '2026-10-14' })).today).toBe('2026-10-14');
    expect(chatSchema.parse(validBody()).today).toBeUndefined();
    expect(chatSchema.parse(validBody({ today: '10/14' })).today).toBeNull();
    const memories = [{ id: 12, kind: 'PREFERENCE', content: '짧게', expiresOn: '2026-10-19' }];
    expect(chatSchema.parse(validBody({ memories, memoryEnabled: true })).memories.items).toEqual(memories);
  });

  it('WP-379: 메모리 항목의 scope 를 보존한다', () => {
    const memories = [{ id: 12, kind: 'PREFERENCE', content: '짧게', scope: 'ISSUE' }];
    expect(chatSchema.parse(validBody({ memories, memoryEnabled: true })).memories).toEqual({ items: memories, dropped: 0 });
  });

  it('memories·memoryEnabled 가 보존된다', () => {
    const memories = [{ id: 12, kind: 'PREFERENCE', content: '짧은 목록으로 보여 준다' }];
    const parsed = chatSchema.parse(validBody({ memories, memoryEnabled: true }));
    expect(parsed.memories).toEqual({ items: memories, dropped: 0 });
    expect(parsed.memoryEnabled).toBe(true);
  });
  // F-k: 모르는(미래의) kind·모양이 틀린 항목은 그 항목만 버린다 — 채팅 요청 전체를 400 으로 막지 않는다.
  it('kind 가 enum 밖이거나 모양이 틀린 메모리는 그 항목만 버리고 요청은 통과한다', () => {
    const ok = { id: 12, kind: 'CONTEXT', content: '백엔드 팀이다' };
    const parsed = chatSchema.safeParse(
      validBody({ memories: [{ id: 1, kind: 'GOAL', content: 'y' }, ok, { id: 0, kind: 'PREFERENCE', content: 'z' }, 'x'], memoryEnabled: true }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data?.memories).toEqual({ items: [ok], dropped: 3 });
  });
  it('memories 가 배열이 아니면 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ memories: 'x' })).success).toBe(false);
  });

  it('유효 페이로드는 파싱 성공', () => {
    expect(chatSchema.safeParse(validBody()).success).toBe(true);
  });

  it('신규 필수 비서 필드 누락 → 파싱 실패', () => {
    const { assistantAgentId: _omit, ...rest } = validBody();
    void _omit;
    expect(chatSchema.safeParse(rest).success).toBe(false);
  });

  // #430: 공백 전용 쿼리는 trim 후 min(1) 에서 거부돼야 한다.
  it('공백 전용 쿼리("   ") → 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ query: '   ' })).success).toBe(false);
  });

  it('thinkingDepth 가 enum 밖이면 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ thinkingDepth: 'WAT' })).success).toBe(false);
  });

  // #376: userId 필수 필드 검증.
  it('userId 누락 → 파싱 실패', () => {
    const { userId: _omit, ...rest } = validBody();
    void _omit;
    expect(chatSchema.safeParse(rest).success).toBe(false);
  });

  // #719: tenantId 는 선택 필드 — 미포함/null 모두 파싱 성공해야 한다(테넌트 미해결 경로 호환).
  it('tenantId 없어도 파싱 성공(선택 필드)', () => {
    expect(chatSchema.safeParse(validBody()).success).toBe(true);
  });

  it('tenantId 양수 포함 시 파싱 성공', () => {
    expect(chatSchema.safeParse(validBody({ tenantId: 1 })).success).toBe(true);
  });

  it('tenantId 가 0 이하면 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ tenantId: 0 })).success).toBe(false);
  });
  // WP-54: 화면 컨텍스트 — 정상·null 허용, 상한 초과는 거부.
  it('screenContext 정상/null 은 파싱 성공하고 값이 보존된다', () => {
    const ctx = { view: '이슈 상세', focus: { type: '이슈', label: 'WP-1 a', refs: { issueKey: 'WP-1' } } };
    const parsed = chatSchema.safeParse(validBody({ screenContext: ctx }));
    expect(parsed.success && parsed.data.screenContext).toEqual(ctx);
    expect(chatSchema.safeParse(validBody({ screenContext: null })).success).toBe(true);
  });
  it('screenContext 상한 초과 → 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ screenContext: { view: 'x'.repeat(51) } })).success).toBe(false);
  });
  it('contextSummary 문자열/null/생략 모두 파싱 성공하고 값이 보존된다 (WP-232)', () => {
    expect(chatSchema.parse(validBody({ contextSummary: '요약' })).contextSummary).toBe('요약');
    expect(chatSchema.safeParse(validBody({ contextSummary: null })).success).toBe(true);
    expect(chatSchema.safeParse(validBody()).success).toBe(true);
  });

  // WP-234: 메인 AI 채팅 첨부
  const SID = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
  const att = (current: boolean) => ({
    fileId: 8, messageId: 3, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, current,
    extraction: { status: 'READY', totalChars: 10, truncated: false, reasonCode: null, reason: null },
  });

  it('구 API 페이로드(sessionId·attachments 없음)도 파싱 성공 — attachments 는 빈 배열 (WP-234 롤링 배포)', () => {
    const parsed = chatSchema.parse(validBody());
    expect(parsed.attachments).toEqual([]);
    expect(parsed.sessionId).toBeUndefined();
  });

  it('sessionId(UUID)·attachments 가 보존된다, attachments null 은 빈 배열', () => {
    const parsed = chatSchema.parse(validBody({ sessionId: SID, attachments: [att(true)] }));
    expect(parsed.sessionId).toBe(SID);
    expect(parsed.attachments[0]).toMatchObject({ fileId: 8, current: true });
    expect(chatSchema.parse(validBody({ attachments: null })).attachments).toEqual([]);
  });

  it('sessionId 가 UUID 가 아니면 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ sessionId: 'abc' })).success).toBe(false);
  });

  it('빈 query + 이번 메시지 첨부(current) 있음 → 파싱 성공', () => {
    expect(chatSchema.safeParse(validBody({ query: '', sessionId: SID, attachments: [att(true)] })).success).toBe(true);
  });

  it('빈 query + 이전 턴 첨부만(current 없음) → 파싱 실패', () => {
    expect(chatSchema.safeParse(validBody({ query: '  ', sessionId: SID, attachments: [att(false)] })).success).toBe(false);
  });
});

describe('POST /ai/chat', () => {
  it('WP-379: app 을 runAiChatStream 입력으로 전달', async () => {
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: 'ok', widgets: null, pendingActions: [], source: 'router_prose', usage: null });
    await request(buildApp()).post('/ai/chat').send(validBody({ app: 'ISSUE' }));
    expect(vi.mocked(runAiChatStream).mock.calls[0][0]).toEqual(expect.objectContaining({ app: 'ISSUE' }));
  });

  it('WP-379: 고침 결과의 scope·previousScope 를 memory 필드에 싣는다(공통 = null)', async () => {
    const updated = {
      action: 'updated',
      memoryId: 12,
      kind: 'PREFERENCE',
      content: '이슈는 짧게',
      previousContent: '짧게',
      source: 'AI',
      scope: 'ISSUE',
      previousScope: null,
    };
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, _t, _s, _p, onTool) => {
      onTool?.({ seq: 1, event: 'tool_result', toolName: 'update_memory', isError: false, result: JSON.stringify(updated) });
      return { fullText: '고쳤어요.', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    const tools = [...res.text.matchAll(/event: tool\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
    expect(tools[0].memory).toEqual(updated);
  });

  it('WP-55: memories·memoryEnabled 를 runAiChatStream 입력으로 전달', async () => {
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: 'ok', widgets: null, pendingActions: [], source: 'router_prose', usage: null });
    const memories = [{ id: 12, kind: 'PREFERENCE', content: '짧은 목록으로 보여 준다' }];
    await request(buildApp()).post('/ai/chat').send(validBody({ memories, memoryEnabled: true }));
    expect(runAiChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ memories, memoryEnabled: true }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  // CR10: 모양이 틀린 메모리 항목을 버리면 개수만 WARN 으로 남긴다 — 내용(사용자 메모리)은 로그에 싣지 않는다.
  it('WP-55: 버린 메모리 항목 수를 WARN 으로 남기고 내용은 싣지 않는다', async () => {
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: 'ok', widgets: null, pendingActions: [], source: 'router_prose', usage: null });
    const ok = { id: 12, kind: 'PREFERENCE', content: '짧은 목록으로 보여 준다' };
    const bad = [{ id: 1, kind: 'GOAL', content: '비밀스러운 내용' }, 'x'];
    await request(buildApp()).post('/ai/chat').send(validBody({ memories: [ok, ...bad], memoryEnabled: true }));
    const warns = logMock.warn.mock.calls.filter((c) => c[1] === 'memories_dropped');
    expect(warns).toHaveLength(1);
    expect(warns[0][0]).toBe('ai-chat');
    expect(warns[0][2]).toEqual({ requestId: expect.any(String), dropped: 2 });
    expect(JSON.stringify(logMock.warn.mock.calls)).not.toContain('비밀스러운 내용');
  });

  it('WP-55: 버린 메모리 항목이 없으면 WARN 을 남기지 않는다', async () => {
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: 'ok', widgets: null, pendingActions: [], source: 'router_prose', usage: null });
    await request(buildApp()).post('/ai/chat').send(validBody({ memories: [{ id: 12, kind: 'PREFERENCE', content: 'a' }] }));
    await request(buildApp()).post('/ai/chat').send(validBody());
    expect(logMock.warn.mock.calls.filter((c) => c[1] === 'memories_dropped')).toHaveLength(0);
  });

  // CR1: 고침 결과의 이전 종류도 tool SSE memory 에 그대로 싣는다(API 가 블록에 남긴다).
  it('WP-55: 고침 결과의 previousKind 를 memory 필드에 싣는다', async () => {
    const updated = {
      action: 'updated',
      memoryId: 12,
      kind: 'CONTEXT',
      content: '백엔드 팀',
      previousContent: '짧은 목록',
      previousKind: 'PREFERENCE',
      source: 'AI',
    };
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, _t, _s, _p, onTool) => {
      onTool?.({ seq: 1, event: 'tool_result', toolName: 'update_memory', isError: false, result: JSON.stringify(updated) });
      return { fullText: '고쳤어요.', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    const tools = [...res.text.matchAll(/event: tool\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
    expect(tools[0].memory).toEqual(updated);
  });

  // WP-55: tool SSE 는 결과 원문을 계속 버리고, 메모리 도구(허용 목록)의 성공 결과만 파싱해 memory 필드로 싣는다.
  it('WP-55: 메모리 도구 성공 결과만 memory 필드로 싣는다(오류·다른 도구·깨진 JSON 제외)', async () => {
    const saved = { action: 'saved', memoryId: 12, kind: 'PREFERENCE', content: '짧은 목록', source: 'AI' };
    const forgotten = { action: 'forgotten', memoryId: 9, kind: 'CONTEXT', content: '백엔드 팀', source: 'USER' };
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, _t, _s, _p, onTool) => {
      onTool?.({ seq: 1, event: 'tool_use_start', toolName: 'remember_memory', args: { kind: 'PREFERENCE', content: '짧은 목록' } });
      onTool?.({ seq: 1, event: 'tool_result', toolName: 'remember_memory', isError: false, result: JSON.stringify(saved) });
      onTool?.({ seq: 2, event: 'tool_result', toolName: 'workplace_forget_memory', isError: false, result: JSON.stringify(forgotten) });
      onTool?.({ seq: 3, event: 'tool_result', toolName: 'update_memory', isError: true, result: 'API 오류 409: 메모리가 가득 찼어요' });
      onTool?.({ seq: 4, event: 'tool_result', toolName: 'list_issues', isError: false, result: JSON.stringify(saved) });
      onTool?.({ seq: 5, event: 'tool_result', toolName: 'update_memory', isError: false, result: '{깨짐' });
      return { fullText: '기억할게요.', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    const tools = [...res.text.matchAll(/event: tool\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
    expect(tools).toHaveLength(6);
    expect(tools[0].memory).toBeUndefined(); // start
    expect(tools[1].memory).toEqual(saved);
    expect(tools[2].memory).toEqual(forgotten); // opencode 접두(workplace_)도 같은 도구
    for (const t of tools.slice(3)) expect(t.memory).toBeUndefined();
    for (const t of tools) expect(t).not.toHaveProperty('result');
  });

  it('델타 2개 → event: delta 2개 + event: done 발행', async () => {
    // 러너가 onText 를 2회 호출(점진 write) 후 정상 종료. done에 fullText + widgets 포함.
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, onText) => {
      onText('안');
      onText('녕');
      return { fullText: '안녕', widgets: null, pendingActions: [], source: 'router_prose', usage: { inputTokens: 100, outputTokens: 20 } };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
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
    // 러너에 파싱된 페이로드가 그대로 전달됐는지 회귀 가드(5번째 onProgress, 6번째 onTool, 7번째 onDelta 인자 포함).
    expect(runAiChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일', assistantAgentId: 7 }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('query 누락(빈 문자열) → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/ai/chat').send(validBody({ query: '' }));
    expect(res.status).toBe(400);
    expect(runAiChatStream).not.toHaveBeenCalled();
  });

  // #430: 공백 전용 쿼리는 trim 후 비어 있으므로 400 을 반환해야 한다.
  it('공백 전용 쿼리("   ") → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/ai/chat').send(validBody({ query: '   ' }));
    expect(res.status).toBe(400);
    expect(runAiChatStream).not.toHaveBeenCalled();
  });

  it('done 이벤트에 답 출처 source 를 싣는다 (WP-139)', async () => {
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: 'ok', widgets: null, pendingActions: [], source: 'subagent', usage: null });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    expect(res.text).toContain('"source":"subagent"');
  });

  // WP-234: 첨부 필드가 러너 입력까지 전달된다(plain z.object 는 미정의 키를 버리므로 스키마 명시 필요).
  it('sessionId·attachments 를 runAiChatStream 입력으로 전달', async () => {
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: 'ok', widgets: null, pendingActions: [], source: 'router_prose', usage: null });
    const sid = '3f1c2a4e-8b7d-4c1e-9f2a-6d5b4c3a2e1f';
    const attachment = {
      fileId: 8, messageId: 3, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, current: true,
      extraction: { status: 'PENDING', totalChars: null, truncated: null, reasonCode: null, reason: null },
    };
    await request(buildApp()).post('/ai/chat').send(validBody({ query: '', sessionId: sid, attachments: [attachment] }));
    expect(runAiChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '', sessionId: sid, attachments: [attachment] }),
      expect.anything(), expect.any(Function), expect.anything(),
      expect.any(Function), expect.any(Function), expect.any(Function),
    );
  });

  it('비서 필드 누락 → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/ai/chat').send({ query: 'x' });
    expect(res.status).toBe(400);
    expect(runAiChatStream).not.toHaveBeenCalled();
  });

  it('러너 오류 → event: error 발행', async () => {
    vi.mocked(runAiChatStream).mockRejectedValue(new Error('cli boom'));
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('chat_failed');
  });

  it('pendingActions 가 있으면 event: pending_action 을 done 앞에 배열로 발행', async () => {
    // #351: propose 도구가 사이드카에 제안을 쓴 경우 — 라우트가 done 앞에 pending_action(배열) 발행.
    vi.mocked(runAiChatStream).mockResolvedValue({ fullText: '제안했어요', widgets: null, pendingActions: [{ actionType: 'calendar.create_event', summary: 's', params: {} }], source: 'fallback', usage: null });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    expect(res.text).toContain('event: pending_action');
    expect(res.text).toContain('"actionType":"calendar.create_event"');
    // 순서: pending_action 인덱스 < done 인덱스
    expect(res.text.indexOf('event: pending_action')).toBeLessThan(res.text.indexOf('event: done'));
  });

  it('위임 진행(onProgress) → event: progress 발행', async () => {
    // 러너가 onProgress 를 호출(위임 라벨) 후 정상 종료하도록 mock.
    // 라우트가 5번째 인자로 onProgress 콜백을 전달하고 event: progress 로 직렬화하는지 검증.
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, _onText, _signal, onProgress) => {
      onProgress?.('이슈 전문가에게 위임 중');
      return { fullText: '처리했어요.', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: progress');
    expect(res.text).toContain('"label":"이슈 전문가에게 위임 중"');
    // 라우트가 onProgress(5번째 인자), onTool(6번째 인자), onDelta(7번째 인자)를 함수로 전달했는지 회귀 가드.
    expect(runAiChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: '내 할 일' }),
      expect.anything(),
      expect.any(Function),
      expect.any(AbortSignal),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  // #463: 라우터 prose 라이브 스트리밍 — onDelta 호출 시 event: delta 다건 발행.
  it('라우터 prose 라이브 → event: delta 다건 발행', async () => {
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, _onText, _sig, _onProg, _onTool, onDelta) => {
      onDelta?.('오늘 일정은 ');
      onDelta?.('2건입니다.');
      return { fullText: '오늘 일정은 2건입니다.', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    expect(res.status).toBe(200);
    const deltaEvents = res.text.match(/event: delta\n/g) ?? [];
    expect(deltaEvents).toHaveLength(2);
    expect(res.text).toContain('data: {"text":"오늘 일정은 "}');
    expect(res.text).toContain('data: {"text":"2건입니다."}');
    expect(res.text).toContain('event: done');
  });

  // #463: 위임 답(onText 경로) — 사이드카 최종 답은 event: delta 1건으로 발행.
  it('위임 답은 최종 delta 1건으로 발행', async () => {
    vi.mocked(runAiChatStream).mockImplementation(async (_i, _d, onText) => {
      onText('연락처 3건을 정리했어요.');
      return { fullText: '연락처 3건을 정리했어요.', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    const res = await request(buildApp()).post('/ai/chat').send(validBody());
    expect(res.status).toBe(200);
    const deltaEvents = res.text.match(/event: delta\n/g) ?? [];
    expect(deltaEvents).toHaveLength(1);
    expect(res.text).toContain('data: {"text":"연락처 3건을 정리했어요."}');
    expect(res.text).toContain('event: done');
  });
});

describe('POST /home/priority-classify', () => {
  const validBody = {
    items: [{ sourceType: 'ISSUE_DUE', sourceId: '1', title: '이슈 A', context: '마감 오늘' }],
    assistantAgentId: 99,
    model: 'claude-sonnet-5',
    maxTurns: 6,
    timeoutMs: 90000,
  };

  it('유효하지 않은 바디는 400을 반환한다', async () => {
    const res = await request(buildApp()).post('/home/priority-classify').send({});
    expect(res.status).toBe(400);
    expect(runHomePriorityClassify).not.toHaveBeenCalled();
  });

  it('러너를 호출해 200과 결과를 반환한다', async () => {
    vi.mocked(runHomePriorityClassify).mockResolvedValue({
      results: [{ sourceType: 'ISSUE_DUE', sourceId: '1', importanceScore: 80, urgencyScore: 90, reason: '고객 마감' }],
    });
    const res = await request(buildApp()).post('/home/priority-classify').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.results[0].importanceScore).toBe(80);
    expect(runHomePriorityClassify).toHaveBeenCalledWith(
      expect.objectContaining({ assistantAgentId: 99 }),
      expect.anything(),
    );
  });

  it('러너 실패 시 502를 반환한다', async () => {
    vi.mocked(runHomePriorityClassify).mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post('/home/priority-classify').send(validBody);
    expect(res.status).toBe(502);
  });
});

describe('/ai/chat 로그', () => {
  beforeEach(() => {
    logMock.info.mockClear();
    logMock.error.mockClear();
  });

  it('요청 시작 시 start 로그를 requestId·query 와 함께 발행한다', async () => {
    vi.mocked(runAiChatStream).mockImplementation(async (_input, _deps, onText) => {
      onText('답변');
      return { fullText: '답변', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    await request(buildApp()).post('/ai/chat').send(validBody({ query: '내 현황' }));
    const startCall = logMock.info.mock.calls.find((c) => c[1] === 'start');
    expect(startCall).toBeTruthy();
    expect(startCall![2]).toMatchObject({ query: expect.stringContaining('내 현황'), agentId: 7 });
    expect(typeof startCall![2].requestId).toBe('string');
  });

  it('동일 requestId 가 start 와 done 에 함께 찍힌다', async () => {
    vi.mocked(runAiChatStream).mockImplementation(async (_input, _deps, onText) => {
      onText('답변');
      return { fullText: '답변', widgets: null, pendingActions: [], source: 'router_prose', usage: null };
    });
    await request(buildApp()).post('/ai/chat').send(validBody());
    const start = logMock.info.mock.calls.find((c) => c[1] === 'start');
    const done = logMock.info.mock.calls.find((c) => c[1] === 'done');
    expect(start![2].requestId).toBe(done![2].requestId);
  });
});

describe('JSON 본문 한도 (WP-232)', () => {
  it('128k 토큰 이력(약 400KB) 본문을 받을 수 있게 한도를 4mb 로 둔다', async () => {
    const app = express();
    app.use(express.json({ limit: JSON_BODY_LIMIT }));
    app.post('/echo', (req, res) => res.json({ len: JSON.stringify(req.body).length }));
    const big = { text: '가'.repeat(150_000) }; // UTF-8 약 450KB
    const res = await request(app).post('/echo').send(big);
    expect(res.status).toBe(200);
    expect(JSON_BODY_LIMIT).toBe('4mb');
  });
});

describe('POST /home/context-summary (WP-232)', () => {
  const body = {
    assistantAgentId: 7, model: 'm', maxTurns: 3, timeoutMs: 60_000,
    previousSummary: null, messages: [{ role: 'USER', content: 'a' }],
  };
  it('성공 → 200 { summary }', async () => {
    vi.mocked(runHomeContextSummary).mockResolvedValue({ summary: 's' });
    const res = await request(buildApp()).post('/home/context-summary').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ summary: 's' });
  });
  it('스키마 위반 → 400 (러너 미호출)', async () => {
    const res = await request(buildApp()).post('/home/context-summary').send({ ...body, messages: [] });
    expect(res.status).toBe(400);
    expect(runHomeContextSummary).not.toHaveBeenCalled();
  });
  it('러너 실패 → 502', async () => {
    vi.mocked(runHomeContextSummary).mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post('/home/context-summary').send(body);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'home_context_summary_failed' });
  });
});

describe('POST /home/suggestions (WP-139)', () => {
  const body = { mode: 'starter', agentId: 7, model: null, screenContext: null, recentTitles: ['a'], count: 4, timeoutMs: 15_000 };
  it('성공 → 200 { items }', async () => {
    vi.mocked(runSuggestions).mockResolvedValue({ items: ['오늘 일정 요약해줘'] });
    const res = await request(buildApp()).post('/home/suggestions').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: ['오늘 일정 요약해줘'] });
    expect(vi.mocked(runSuggestions).mock.calls[0][0]).toMatchObject({ mode: 'starter', agentId: 7, count: 4 });
  });
  it('스키마 위반 → 400 (실행 안 함)', async () => {
    const res = await request(buildApp()).post('/home/suggestions').send({ ...body, count: 9 });
    expect(res.status).toBe(400);
    expect(runSuggestions).not.toHaveBeenCalled();
  });
  it('실행 실패 → 502', async () => {
    vi.mocked(runSuggestions).mockRejectedValue(new Error('timeout'));
    const res = await request(buildApp()).post('/home/suggestions').send(body);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'home_suggestions_failed' });
  });
});
