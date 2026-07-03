import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunnerEvent } from './runner-events.js';

// agent-runner mock — runnerFor().stream 을 통해 RunnerEvent 를 onEvent 로 흘린다.
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));

import { runWikiCompose } from './run-wiki-compose.js';
import { type WikiComposeInput } from './wiki-prompt.js';

const fakeClient = { getProviderCredential: vi.fn() } as never;

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

// RunnerEvent 픽스처 헬퍼.
function textDelta(text: string): RunnerEvent {
  return { type: 'text_delta', text, parentToolUseId: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
    vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null });
});

describe('runWikiCompose', () => {
  it('text_delta 만 onDelta 로 흘리고 result 는 제외', async () => {
    // thinking 델타는 애초에 RunnerEvent 로 매핑되지 않으므로(runner-events 계층에서 폐기) 픽스처에 없다.
    streamSpy.mockImplementation((_i, onEvent: (e: RunnerEvent) => void) => {
      onEvent(textDelta('요약: '));
      onEvent(textDelta('핵심'));
      onEvent({ type: 'result', ok: true, text: '요약: 핵심', usage: null }); // 제외(text_delta 아님)
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    await runWikiCompose(baseInput('summarize'), { client: fakeClient }, (t) => got.push(t));
    expect(got.join('')).toBe('요약: 핵심');
    // 회귀 가드: 비서 자격증명을 요청의 assistantAgentId(7)로 실제 fetch 했는지 검증.
    expect((fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential).toHaveBeenCalledWith(7);
  });

  it('모델 결정: input.model(요청 body)이 credential.model 보다 우선한다', async () => {
    (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
      vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: 'claude-opus-4-1' });
    streamSpy.mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runWikiCompose(baseInput('continue'), { client: fakeClient }, () => {});
    const passed = vi.mocked(streamSpy).mock.calls[0][0] as { model: string };
    expect(passed.model).toBe('claude-sonnet-4-6'); // input.model 그대로(body 우선)
  });

  it('includePartialMessages:true 로 러너 stream 호출', async () => {
    streamSpy.mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runWikiCompose(baseInput('continue'), { client: fakeClient }, () => {});
    const passed = vi.mocked(streamSpy).mock.calls[0][0] as {
      includePartialMessages?: boolean; systemPrompt: string; credential: { token: string }; agentId: number;
    };
    expect(passed.includePartialMessages).toBe(true);
    expect(passed.systemPrompt).toContain('위키 문서 작성 보조자');
    expect(passed.credential.token).toBe('tok'); // 비서 토큰이 credential 로 전달
    expect(passed.agentId).toBe(7);
  });

  it('러너 실패(reject) 가 전파된다', async () => {
    streamSpy.mockReturnValue({
      done: Promise.reject(new Error('sdk boom')),
      kill: () => {},
    });
    await expect(
      runWikiCompose(baseInput('summarize'), { client: fakeClient }, () => {}),
    ).rejects.toThrow('sdk boom');
  });

  it('스트리밍 중 abort(addEventListener 경로) → handle.kill 호출', async () => {
    // 프로덕션 경로: 신호가 살아있을 때 리스너가 붙고, 이후 연결 종료로 abort 가 발생.
    const kill = vi.fn();
    let resolveDone!: () => void;
    streamSpy.mockReturnValue({
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
    streamSpy.mockReturnValue({
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
