import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'x']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCliStream: vi.fn(),
}));
vi.mock('./mcp-config.js', () => ({
  writeEmptyMcpConfig: vi.fn(() => '/tmp/empty.json'),
  cleanupTempMcpConfig: vi.fn(),
}));

import { runWikiCompose } from './run-wiki-compose.js';
import { type WikiComposeInput } from './wiki-prompt.js';
import { runClaudeCliStream, buildCliArgs } from './cli-runner.js';
import { cleanupTempMcpConfig } from './mcp-config.js';

const fakeClient = { getOAuthToken: vi.fn() } as never;

// 비서 설정은 요청 본문으로 온다(env 미사용). 테스트용 기본 입력.
function baseInput(action: WikiComposeInput['action'], over: Partial<WikiComposeInput> = {}): WikiComposeInput {
  return {
    assistantAgentId: 7,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'NORMAL',
    maxTurns: 8,
    timeoutMs: 60_000,
    action,
    pageTitle: '온보딩 가이드',
    pageBody: '## 개요\n신규 입사자 온보딩 절차.',
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

describe('runWikiCompose', () => {
  it('text_delta 만 onDelta 로 흘리고 thinking·result 는 제외', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(thinkingDelta('X')); // 추론 — 제외
      onLine(textDelta('요약: '));
      onLine(textDelta('핵심'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '요약: 핵심' })); // 제외
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    await runWikiCompose(baseInput('summarize'), { client: fakeClient }, (t) => got.push(t));
    expect(got.join('')).toBe('요약: 핵심');
    // 회귀 가드: 비서 토큰을 요청의 assistantAgentId(7)로 실제 fetch 했는지 검증.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });

  it('includePartialMessages:true 로 buildCliArgs 호출', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runWikiCompose(baseInput('continue'), { client: fakeClient }, () => {});
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(passed.includePartialMessages).toBe(true);
    expect(passed.systemPrompt).toContain('위키 문서 작성 보조자');
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: Promise.reject(new Error('cli boom')),
      kill: () => {},
    });
    await expect(
      runWikiCompose(baseInput('summarize'), { client: fakeClient }, () => {}),
    ).rejects.toThrow('cli boom');
    expect(cleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/empty.json');
  });

  it('스트리밍 중 abort(addEventListener 경로) → handle.kill 호출', async () => {
    // 프로덕션 경로: 신호가 살아있을 때 리스너가 붙고, 이후 연결 종료로 abort 가 발생.
    const kill = vi.fn();
    let resolveDone!: () => void;
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: new Promise<void>((r) => { resolveDone = r; }),
      kill,
    });
    const ac = new AbortController();
    const p = runWikiCompose(baseInput('summarize'), { client: fakeClient }, () => {}, ac.signal);
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
    const p = runWikiCompose(baseInput('summarize'), { client: fakeClient }, () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(kill).toHaveBeenCalledOnce();
    resolveDone();
    await p;
  });
});
