import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'x']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCliCollect: vi.fn(),
  runClaudeCliStream: vi.fn(),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));

import { runHomeCompose, runHomeComposeStream, type ComposeInput } from './run-home-compose.js';
import { runClaudeCliCollect, runClaudeCliStream, buildCliArgs } from './cli-runner.js';
import { cleanupTempMcpConfig } from './mcp-config.js';

const fakeClient = { getOAuthToken: vi.fn() } as never;

// 비서 설정은 이제 요청 본문으로 온다(env 미사용). 테스트용 기본 입력.
function baseInput(over: Partial<ComposeInput> = {}): ComposeInput {
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

// 실측 stream-json 모양 라인 직렬화 헬퍼.
function textDelta(text: string): string {
  return JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
  });
}
function thinkingDelta(thinking: string): string {
  return JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken =
    vi.fn().mockResolvedValue({ token: 'tok', label: null });
});

describe('runHomeCompose (블로킹 — 기존 동기 경로)', () => {
  it('CLI 출력 라인을 파싱해 {message, widgets} 반환', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '할 일이에요.' }),
    ]);
    const out = await runHomeCompose(baseInput(), { client: fakeClient });
    expect(out).toEqual({ message: '할 일이에요.', widgets: [{ type: 'my_tasks', params: {} }] });
    // 회귀 가드: 비서 토큰을 요청의 assistantAgentId(7)로 실제 fetch 했는지 검증.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });

  it('요청의 assistantAgentId 로 토큰을 fetch 한다(env 미사용)', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(baseInput({ assistantAgentId: 42 }), { client: fakeClient });
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(42);
  });

  it('thinkingDepth(DEEP) 를 system-prompt 에 반영해 buildCliArgs 에 전달', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(baseInput({ thinkingDepth: 'DEEP' }), { client: fakeClient });
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(passed.systemPrompt).toContain('신중하게');
    expect(passed.model).toBe('claude-sonnet-4-6');
    expect(passed.maxTurns).toBe(8);
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliCollect).mockRejectedValue(new Error('cli boom'));
    await expect(runHomeCompose(baseInput(), { client: fakeClient })).rejects.toThrow('cli boom');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/cfg.json');
  });

  it('recentContext 를 프롬프트에 임베드해 buildCliArgs 에 전달', async () => {
    vi.mocked(runClaudeCliCollect).mockResolvedValue([]);
    await runHomeCompose(
      baseInput({ query: '그 중 HIGH 만', recentContext: [{ role: 'USER', content: '내 담당 보여줘' }] }),
      { client: fakeClient },
    );
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0].userMessage;
    expect(passed).toContain('내 담당 보여줘');
    expect(passed).toContain('그 중 HIGH 만');
  });
});

describe('runHomeComposeStream (스트리밍 — SSE 라우트용)', () => {
  it('text_delta 만 onText 로 흘리고 thinking 은 제외', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(thinkingDelta('추론 과정')); // 추론 — 제외
      onLine(textDelta('안녕 '));
      onLine(textDelta('하세요'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '안녕 하세요' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    const result = await runHomeComposeStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got.join('')).toBe('안녕 하세요');
    expect(result.fullText).toBeTruthy(); // fullText 반환
    // 회귀 가드: 비서 토큰을 요청의 assistantAgentId(7)로 fetch 했는지 검증.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });

  it('done 에서 parseComposeLines 로 widgets 와 fullText 를 산출한다', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // tool_use 라인은 delta 아님 — lines 에만 쌓여 parseComposeLines 가 처리
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '할 일이에요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const result = await runHomeComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(result.fullText).toBe('할 일이에요.');
    expect(result.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  it('includePartialMessages:true 로 buildCliArgs 호출', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runHomeComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(passed.includePartialMessages).toBe(true);
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: Promise.reject(new Error('cli boom')),
      kill: () => {},
    });
    await expect(
      runHomeComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal),
    ).rejects.toThrow('cli boom');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/cfg.json');
  });

  it('스트리밍 중 abort(addEventListener 경로) → handle.kill 호출', async () => {
    const kill = vi.fn();
    let resolveDone!: () => void;
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: new Promise<void>((r) => { resolveDone = r; }),
      kill,
    });
    const ac = new AbortController();
    const p = runHomeComposeStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
    // 토큰 fetch(microtask) 후 리스너가 붙도록 한 틱 양보한 뒤 abort.
    await new Promise((r) => setTimeout(r, 0));
    ac.abort();
    expect(kill).toHaveBeenCalledOnce();
    resolveDone();
    await p;
  });

  it('이미 abort 된 신호 → 즉시 handle.kill 호출', async () => {
    const kill = vi.fn();
    let resolveDone!: () => void;
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: new Promise<void>((r) => { resolveDone = r; }),
      kill,
    });
    const ac = new AbortController();
    ac.abort(); // fetch 전에 이미 종료된 상태
    const p = runHomeComposeStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(kill).toHaveBeenCalledOnce();
    resolveDone();
    await p;
  });
});
