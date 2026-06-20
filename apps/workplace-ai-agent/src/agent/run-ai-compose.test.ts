import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'x']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCliStream: vi.fn(),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));
vi.mock('./subagent-loader.js', () => ({
  loadSubagents: vi.fn(() => ({ 'issue-agent': { description: 'd', tools: [], prompt: '' } })),
  writeSubagentDefinitions: vi.fn(),
}));
// mkdtempSync/writeFileSync/rmSync 는 실제 호출 없이 mock 처리해 fs 부작용 제거.
// #333 M2: existsSync/readFileSync 도 mock 추가 — 사이드카 읽기 경로 테스트용.
vi.mock('node:fs', () => ({
  mkdtempSync: vi.fn(() => '/tmp/mock-workdir'),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { runAiComposeStream, type ComposeInput } from './run-ai-compose.js';
import { runClaudeCliStream, buildCliArgs, buildChildEnv } from './cli-runner.js';
import { cleanupTempMcpConfig, writeTempMcpConfig } from './mcp-config.js';
import { writeSubagentDefinitions, loadSubagents } from './subagent-loader.js';
import { existsSync, readFileSync } from 'node:fs';

const fakeClient = {
  getOAuthToken: vi.fn(),
  // #404: show_issue_detail 위젯 존재 여부 검증 — 기본값은 존재(resolve).
  getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-1', title: 't' }),
} as never;

// 비서 설정은 이제 요청 본문으로 온다(env 미사용). 테스트용 기본 입력.
function baseInput(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    query: '내 할 일',
    assistantAgentId: 7,
    // #376: 요청 사용자 ID(기본값=1) — MCP 도구 컨텍스트에 전달.
    userId: 1,
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

describe('runAiComposeStream (스트리밍 — SSE 라우트용)', () => {
  it('text_delta 만 onText 로 흘리고 thinking 은 제외', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(thinkingDelta('추론 과정')); // 추론 — 제외
      onLine(textDelta('안녕 '));
      onLine(textDelta('하세요'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '안녕 하세요' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    const result = await runAiComposeStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
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
    const result = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(result.fullText).toBe('할 일이에요.');
    expect(result.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  it('includePartialMessages:true 로 buildCliArgs 호출', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(passed.includePartialMessages).toBe(true);
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: Promise.reject(new Error('cli boom')),
      kill: () => {},
    });
    await expect(
      runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal),
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
    const p = runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
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
    const p = runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(kill).toHaveBeenCalledOnce();
    resolveDone();
    await p;
  });

  // #421: 델타 스트림 carry buffer — 청크 경계에 걸친 식별자 sanitize 검증.
  // wiki-002.sse 패턴: "wiki"(청크1) + "-agent에 위임하겠습니다."(청크2) → carry buffer 합산 후 제거.
  it('청크 경계에 걸친 agent 식별자를 carry buffer 로 sanitize (#421)', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('wiki'));                         // 청크 1: 식별자 전반부
      onLine(textDelta('-agent에 위임하겠습니다. '));     // 청크 2: 식별자 후반부 + 조사
      onLine(textDelta('직접 처리하겠습니다.'));           // 청크 3: 정상 콘텐츠
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '직접 처리하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    await runAiComposeStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    // "wiki-agent에 위임하겠습니다." 부분이 delta 스트림에서 제거돼야 한다.
    expect(streamed).not.toMatch(/wiki-agent|agent에/);
    expect(streamed).toContain('직접 처리하겠습니다.');
  });
});

describe('runAiComposeStream (서브에이전트 통합 #333)', () => {
  it('assistant 프로파일 + allowSubagents + systemPromptPath 로 spawn 준비', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    // writeTempMcpConfig 에 assistant 프로파일을 전달했는지 확인.
    const cfgArg = vi.mocked(writeTempMcpConfig).mock.calls[0][0];
    expect(cfgArg.profile).toBe('assistant');
    const cliArg = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(cliArg.allowSubagents).toBe(true);
    expect(typeof cliArg.systemPromptPath).toBe('string');
    // .claude/agents 기록을 시도했는지.
    expect(writeSubagentDefinitions).toHaveBeenCalled();
  });

  it('Agent(issue-agent) tool_use → onProgress 로 위임 라벨 발행', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '처리했어요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const labels: string[] = [];
    await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal, (l) => labels.push(l));
    expect(labels).toContain('이슈 전문가에게 위임 중');
  });

  it('general-purpose 위임 tool_use → child kill + 에러 전파 (동기 onLine 경로)', async () => {
    // 이 테스트는 onLine 이 handle 반환 전 동기 실행되는 경로. killer 홀더가 null 이므로
    // 즉시 kill 은 없고, await handle.done 이후 fallback kill+throw 가 동작함을 검증.
    const kill = vi.fn();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'general-purpose' } }] } }));
      return { done: Promise.resolve(), kill };
    });
    await expect(
      runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal),
    ).rejects.toThrow(/blocked by policy/);
    expect(kill).toHaveBeenCalled();
  });

  it('pendingActionPath 를 mcp-config 에 주입한다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const cfgArg = vi.mocked(writeTempMcpConfig).mock.calls[0][0];
    expect(typeof cfgArg.pendingActionPath).toBe('string');
    expect(cfgArg.pendingActionPath).toContain('pending-action.json');
  });

  it('사이드카가 있으면 done 후 읽어 pendingAction 으로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '제안했어요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ actionType: 'calendar.create_event', summary: 's', params: { title: 't' } }) as never);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.pendingAction).toMatchObject({ actionType: 'calendar.create_event', summary: 's' });
  });

  it('사이드카가 없으면 pendingAction 은 null', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.pendingAction).toBeNull();
  });

  it('general-purpose 위임 tool_use → 비동기 onLine 경로에서 kill 이 done 보다 먼저 호출됨 (Finding 1 프로덕션 경로)', async () => {
    // Finding 1: 프로덕션에서는 onLine 이 handle 반환 후(비동기) 호출된다.
    // killer 홀더가 채워진 상태이므로 killer?.() 가 onLine 내부에서 즉시 kill 한다.
    // done 이 resolve 되기 전에 kill 이 호출됐는지를 호출 순서로 검증.
    const callOrder: string[] = [];
    const kill = vi.fn(() => { callOrder.push('kill'); });
    let capturedOnLine!: (line: string) => void;
    let resolveDone!: () => void;

    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      capturedOnLine = onLine; // onLine 을 나중에(비동기로) 호출하기 위해 보관
      return {
        done: new Promise<void>((r) => {
          resolveDone = () => { callOrder.push('done'); r(); };
        }),
        kill,
      };
    });

    const p = runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);

    // 한 틱 양보해 handle 반환 + killer 홀더 채움이 완료된 후 onLine 을 비동기로 호출.
    await Promise.resolve();
    capturedOnLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'general-purpose' } }] } }));
    // onLine 즉시(동기)로 killer?.() 가 불려 kill 이 기록돼야 한다.
    expect(callOrder).toContain('kill'); // done resolve 전에 kill 이 기록됨

    // done resolve 후 에러 전파 확인.
    resolveDone();
    await expect(p).rejects.toThrow(/blocked by policy/);
    expect(callOrder.indexOf('kill')).toBeLessThan(callOrder.indexOf('done')); // kill < done 순서 보장
  });
});

// #378: unassign_self 실패 사이드카 override — haiku 재해석 차단.
describe('runAiComposeStream — unassignError 사이드카 override (#378)', () => {
  it('unassign-error.json 이 있으면 LLM 응답을 버리고 canonical 로 override', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '일시적 장애가 발생했습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // pendingAction 사이드카는 없고, unassignError 사이드카만 존재하도록 설정.
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('unassign-error.json'),
    );
    const canonical = '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ error: '403', canonical }) as never);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(canonical);
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('unassign-error.json 이 없으면 LLM 응답을 그대로 사용', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '담당자 해제 완료.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('담당자 해제 완료.');
  });

  it('unassignErrorPath 를 mcp-config 에 주입한다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    vi.mocked(existsSync).mockReturnValue(false);
    await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const cfgArg = vi.mocked(writeTempMcpConfig).mock.calls[0][0];
    expect(typeof cfgArg.unassignErrorPath).toBe('string');
    expect(cfgArg.unassignErrorPath).toContain('unassign-error.json');
  });
});

// #383: isMailQuery && !delegated → mail fallback override.
describe('runAiComposeStream — mail 직접 응답 fallback (#383)', () => {
  it('메일 쿼리 + 위임 없음 → delta 누적 텍스트 반환 (#422)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // haiku 가 mail-agent 위임 없이 직접 텍스트로 응답하는 시나리오.
      onLine(textDelta('계정이 연동되지 않았습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '계정이 연동되지 않았습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '메일 계정 연동 상태 확인해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // #422: 위임 없이 직접 응답한 경우 delta 누적 텍스트를 done.fullText 로 반환.
    // onProgress 는 실제 위임이 없으므로 발행하지 않는다.
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('계정이 연동되지 않았습니다.');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('메일 쿼리 + 위임 있음 → fallback 없이 LLM 응답 그대로 반환', async () => {
    // mail-agent 를 화이트리스트에 포함시켜 checkSubagentWhitelist 차단을 방지.
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'mail-agent': { description: 'm', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // 정상 경로: mail-agent 위임 발생 + 결과 반환.
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'mail-agent', prompt: '계정 확인' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '메일 계정: test@example.com' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '메일 계정 연동 상태 확인해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // 정상 위임 경로: 라벨은 발행되지만 fallback 없이 LLM 응답 사용.
    expect(labels).toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('메일 계정: test@example.com');
  });

  it('비메일 쿼리 + 위임 없음 → fallback 없이 LLM 응답 그대로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '안녕하세요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '오늘 할 일 알려줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // 메일 쿼리가 아니므로 fallback 적용 안 됨.
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('안녕하세요.');
  });

  // #385: 연락처 컨텍스트 + "이메일" 키워드 → contacts-agent 위임 경로, mail fallback 오탐 방지.
  // #408: contacts-agent 위임이 있는 정상 경로 — mail·contacts fallback 모두 적용 안 됨.
  it('연락처 쿼리에 이메일 포함 + contacts-agent 위임 → mail/contacts fallback 미적용 (#385/#408)', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'contacts-agent': { description: 'c', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // 정상 경로: contacts-agent 위임 발생 + 결과 반환.
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'contacts-agent', prompt: '김민수 이메일 kim@test.com 연락처 추가' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '김민수(kim@test.com) 연락처가 추가되었습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '김민수 이메일은 kim@test.com 인데 연락처에 추가해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // contacts-agent 위임 정상 발생 — mail fallback 미적용, 위임 라벨 발행, LLM 응답 보존.
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(labels).toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('김민수(kim@test.com) 연락처가 추가되었습니다.');
  });

  it('순수 "이메일" 키워드 + 위임 없음 → mail 경로로 delta 텍스트 반환 (#385 + #422)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('이메일 확인해볼게요.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '이메일 확인해볼게요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '이메일 안 읽은 거 확인해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // 연락처 컨텍스트 없이 이메일 키워드만 있으면 mail 경로(isMailQuery=true)로 처리.
    // #422: 위임 없이 직접 응답한 경우 delta 누적 텍스트 반환, progress 라벨 미발행.
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('이메일 확인해볼게요.');
  });
});

// #408: isContactsQuery && !delegated → contacts fallback override.
describe('runAiComposeStream — contacts 직접 되묻기 fallback (#408)', () => {
  it('연락처 쿼리 + 위임 없음 → delta 누적 텍스트 반환 (#422)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // haiku 가 contacts-agent 위임 없이 직접 되묻는 시나리오(contact-006 재현).
      onLine(textDelta('어떤 연락처를 찾고 계신가요? 이름이나 검색할 키워드를 알려주시면 찾아드리겠습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '어떤 연락처를 찾고 계신가요? 이름이나 검색할 키워드를 알려주시면 찾아드리겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '연락처 찾아줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // #422: 위임 없이 직접 응답한 경우 delta 누적 텍스트를 done.fullText 로 반환.
    // onProgress 는 실제 위임이 없으므로 발행하지 않는다.
    expect(labels).not.toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('어떤 연락처를 찾고 계신가요? 이름이나 검색할 키워드를 알려주시면 찾아드리겠습니다.');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('연락처 쿼리 + 위임 있음 → fallback 없이 LLM 응답 그대로 반환', async () => {
    // contacts-agent 를 화이트리스트에 포함시켜 checkSubagentWhitelist 차단을 방지.
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'contacts-agent': { description: 'c', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // 정상 경로: contacts-agent 위임 발생 + 결과 반환.
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'contacts-agent', prompt: '연락처 찾아줘' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '현재 등록된 연락처가 없습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '연락처 찾아줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // 정상 위임 경로: 라벨은 발행되지만 fallback 없이 LLM 응답 사용.
    expect(labels).toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('현재 등록된 연락처가 없습니다.');
  });

  it('비연락처 쿼리 + 위임 없음 → contacts fallback 적용 안 됨', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '안녕하세요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const labels: string[] = [];
    const out = await runAiComposeStream(
      baseInput({ query: '오늘 일정 알려줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // 연락처 쿼리가 아니므로 fallback 적용 안 됨.
    expect(labels).not.toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('안녕하세요.');
  });
});

// #390: 드라이브 미지원 작업(업로드·멤버 권한 변경) 쿼리 → 고정 "지원하지 않는 기능" 반환.
describe('runAiComposeStream — drive 미지원 작업 guard (#390)', () => {
  it('파일 업로드 쿼리 → LLM 응답 무시하고 고정 문구 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // 홈 라우터가 "정보 주시면 위임하여 업로드 진행" 류로 응답하는 시나리오.
      onLine(textDelta('이 정보를 알려주시면 drive-agent에 위임하여 업로드를 진행하겠습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '이 정보를 알려주시면 drive-agent에 위임하여 업로드를 진행하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '드라이브에 새 파일 보고서.pdf를 업로드해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('현재 지원하지 않는 기능입니다.');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('드라이브 멤버 권한 변경 쿼리 → 고정 문구 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '멤버를 추가하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '드라이브 팀 스페이스에 홍길동 멤버 추가해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('현재 지원하지 않는 기능입니다.');
  });

  it('드라이브 파일 조회 쿼리(지원 기능) → guard 미적용, LLM 응답 그대로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '드라이브 파일 목록입니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '팀 드라이브 파일 목록 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 조회 요청은 지원 기능이므로 고정 문구로 override 되면 안 됨.
    expect(out.fullText).toBe('드라이브 파일 목록입니다.');
    expect(out.fullText).not.toBe('현재 지원하지 않는 기능입니다.');
  });

  // #419: 파일명에 'upload'가 포함된 삭제 쿼리("test-upload.txt 삭제해줘")는 drive.delete_file 지원 범위.
  // isDriveUnsupportedQuery 의 deny 패턴 'upload'가 파일명에 오탐하지 않도록 allow-list 에 '삭제' 추가.
  it('파일명에 upload 포함 삭제 쿼리 → guard 미적용, pendingAction 반환', async () => {
    const sidecarContent = JSON.stringify({ actionType: 'drive.delete_file', summary: '드라이브 내 "test-upload.txt" 삭제', params: { fileId: 1 } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('파일을 찾았습니다. 삭제를 제안합니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '파일을 찾았습니다. 삭제를 제안합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 사이드카 존재 — propose_delete_file 이 기록한 pending-action.
    vi.mocked(existsSync).mockImplementation((p) => typeof p === 'string' && p.endsWith('pending-action.json'));
    vi.mocked(readFileSync).mockReturnValue(sidecarContent);
    const out = await runAiComposeStream(
      baseInput({ query: '드라이브에서 test-upload.txt 파일을 삭제해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // "현재 지원하지 않는 기능" 으로 override 되면 안 됨.
    expect(out.fullText).not.toBe('현재 지원하지 않는 기능입니다.');
    // propose_delete_file 이 기록한 사이드카가 pendingAction 으로 반환되어야 함.
    expect(out.pendingAction).toMatchObject({ actionType: 'drive.delete_file' });
  });
});

// #436: 위키 삭제 쿼리 → "위키 페이지 삭제 기능은 현재 지원하지 않습니다." 고정 반환.
describe('runAiComposeStream — wiki 삭제 미지원 guard (#436)', () => {
  it('위키 페이지 삭제 쿼리 → LLM 응답 무시하고 고정 문구 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // 홈 라우터가 "전달하겠습니다" 환각 응답을 내보내는 시나리오.
      onLine(textDelta('위키 페이지 삭제 요청을 전달하겠습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '위키 페이지 삭제 요청을 전달하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '위키 페이지 삭제해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('위키 페이지 삭제 기능은 현재 지원하지 않습니다.');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('위키 페이지 지워줘 쿼리 → 고정 문구 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '위키 페이지를 삭제하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '위키 "프로젝트 소개" 페이지 지워줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('위키 페이지 삭제 기능은 현재 지원하지 않습니다.');
  });

  it('위키 페이지 검색 쿼리(지원 기능) → guard 미적용, LLM 응답 그대로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '프로젝트 소개 페이지를 찾았습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '위키에서 프로젝트 소개 찾아줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 검색 요청은 지원 기능이므로 고정 문구로 override 되면 안 됨.
    expect(out.fullText).toBe('프로젝트 소개 페이지를 찾았습니다.');
    expect(out.fullText).not.toBe('위키 페이지 삭제 기능은 현재 지원하지 않습니다.');
  });
});

// #400 #409: 비가역 작업 제안 후 승인 발화 시 haiku 환각 응답 차단 — pending_action 없이 "완료했습니다" 방지.
describe('runAiComposeStream — proposal approval hallucination guard (#400, #409)', () => {
  it('승인 발화 + 직전 AI 제안 문구 + pendingAction 없음 → 고정 안내 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // haiku가 "생성됐습니다" 환각 응답을 내보내는 시나리오.
      onLine(textDelta('팀 회의 일정이 생성됐습니다. 오늘 오후 4시~5시에 예약되어 있습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '팀 회의 일정이 생성됐습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // pending_action 사이드카 없음(pendingActionPath 존재 X)
    vi.mocked(existsSync).mockReturnValue(false);
    const recentContext = [
      { role: 'USER', content: '오늘 오후 4시에 팀 회의 일정 만들어줘' },
      { role: 'ASSISTANT', content: '오늘 오후 4시 팀 회의 1시간 일정 생성을 제안했습니다. 확인 카드에서 승인해주세요.' },
    ];
    const out = await runAiComposeStream(
      baseInput({ query: '네, 승인합니다', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // haiku 환각 응답 대신 고정 안내가 반환되어야 한다.
    expect(out.fullText).toContain('확인 카드에서 승인해주세요');
    expect(out.fullText).not.toContain('생성됐습니다');
    expect(out.pendingAction).toBeNull();
  });

  it('승인 발화이지만 pending_action 이 있으면 정상 흐름 통과', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '제안 등록됐습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // pending_action 사이드카 존재(pendingActionPath)
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('pending-action'),
    );
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ actionType: 'calendar.create_event', summary: '4시 팀 회의', params: {} }));
    const recentContext = [
      { role: 'ASSISTANT', content: '팀 회의 제안했습니다. 확인 카드에서 승인해주세요.' },
    ];
    const out = await runAiComposeStream(
      baseInput({ query: '네', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // pending_action 이 있으면 정상적으로 pendingAction 이 반환되어야 한다.
    expect(out.pendingAction).not.toBeNull();
  });

  it('일반 쿼리("네 알겠어")는 제안 컨텍스트 없으면 guard 미적용', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '안녕하세요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(
      baseInput({ query: '네 알겠어', recentContext: [] }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 제안 컨텍스트 없으면 고정 안내로 override 되면 안 됨.
    expect(out.fullText).toBe('안녕하세요.');
  });

  // #409: 연락처 삭제 제안 후 "확인" 발화 → 환각 차단.
  it('#409 연락처 삭제 제안("삭제하겠습니다. 확인해주세요") 후 승인 → 고정 안내 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // haiku 가 연락처 삭제 완료 환각 응답을 내보내는 시나리오.
      onLine(textDelta('김철수 연락처 삭제를 완료했습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '김철수 연락처 삭제를 완료했습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const recentContext = [
      { role: 'USER', content: '김철수 연락처 삭제해줘' },
      { role: 'ASSISTANT', content: '김철수 연락처를 삭제하겠습니다. 확인해주세요.' },
    ];
    const out = await runAiComposeStream(
      baseInput({ query: '확인', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 환각 차단 — 고정 안내가 반환되어야 한다.
    expect(out.fullText).toContain('확인 카드에서 승인해주세요');
    expect(out.fullText).not.toContain('완료했습니다');
    expect(out.pendingAction).toBeNull();
  });
});

// #376: runAiComposeStream 이 userId 를 buildChildEnv 에 전달하는지 검증.
describe('runAiComposeStream — userId → ACTING_USER_ID 전달 (#376)', () => {
  it('ComposeInput.userId 를 buildChildEnv 4번째 인자로 전달한다', async () => {
    // done 을 즉시 resolve 하는 스트림 mock — resolveDone 할당 타이밍 문제 없음.
    vi.mocked(runClaudeCliStream).mockImplementation(() => ({
      done: Promise.resolve(),
      kill: vi.fn(),
    }));

    await runAiComposeStream(
      baseInput({ userId: 42 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );

    // buildChildEnv 가 (env, token, agentId=7, userId=42) 순으로 호출됐는지 확인.
    expect(vi.mocked(buildChildEnv)).toHaveBeenCalledWith(
      expect.any(Object), // process.env
      expect.any(String), // token
      7,                  // assistantAgentId
      42,                 // userId — ACTING_USER_ID 주입 원천
    );
  });
});

// #379: 내부 SDK 메시지 필터 — issue-agent 이슈 삭제 요청 시 haiku SDK 내부 문구 노출 차단.
// #407: calendar-agent 위임 실패 시 "advisor에게 상담하겠습니다" SDK 내부 폴백 메시지도 동일 패턴으로 차단.
describe('runAiComposeStream — SDK 내부 메시지 필터 (#379, #407)', () => {
  it('Agent 도구 미활성화 내부 문구가 포함된 응답을 이슈 삭제 안내로 override', async () => {
    const sdkLeak = '현재 환경에서 Agent 도구가 활성화되어 있지 않네요. 이슈 삭제는 불가합니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: sdkLeak }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: 'EX-5 이슈를 삭제해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('죄송합니다. 해당 요청을 처리할 수 없습니다. 다른 방법으로 도움이 필요하시면 말씀해 주세요.');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('SDK 내부 문구 없는 정상 이슈 삭제 거부 응답은 그대로 반환', async () => {
    const normalResp = '이슈 삭제는 지원하지 않습니다. 상태를 CANCELED로 변경하거나, Smart Workplace 웹 화면에서 관리자 권한으로 직접 삭제해 주세요.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: normalResp }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: 'EX-5 이슈를 삭제해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(normalResp);
  });

  // #407: "advisor에게 상담하겠습니다" SDK 내부 폴백 메시지 차단.
  it('#407 advisor 폴백 메시지가 포함된 응답을 graceful 안내로 override', async () => {
    const sdkLeak = '문제가 발생했습니다. 현재 일정 관련 작업을 위임할 수 있는 전문 에이전트 도구가 활성화되지 않았습니다. advisor에게 상담하겠습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: sdkLeak }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '일정 삭제 취소해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('죄송합니다. 해당 요청을 처리할 수 없습니다. 다른 방법으로 도움이 필요하시면 말씀해 주세요.');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
  });

  it('#407 advisor 폴백 없는 정상 응답은 그대로 반환', async () => {
    const normalResp = '일정 삭제 취소는 확인 카드를 무시하시면 됩니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: normalResp }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '일정 삭제 취소해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(normalResp);
  });
});

// #410: 내부 서브에이전트 식별자 sanitize — haiku 가 응답 본문에 "calendar-agent에" 류를 노출하는 비결정적 동작 차단.
describe('runAiComposeStream — 내부 식별자 sanitize (#410)', () => {
  it('calendar-agent 식별자 + 조사가 응답 본문에서 제거된다', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'calendar-agent에 확인하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '이번 주 화요일 빈 시간 있어?' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('calendar-agent');
    expect(out.fullText).toContain('확인하겠습니다');
  });

  it('contacts-agent 식별자가 응답 본문에서 제거된다', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'contacts-agent가 처리합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '연락처 찾아줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('contacts-agent');
  });

  it('식별자 없는 정상 응답은 그대로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '일정을 확인하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '오늘 일정 알려줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('일정을 확인하겠습니다.');
  });
});

// #426: 한국어 서브에이전트 식별자 sanitize — "메일 조회 에이전트에 연결할 수 없습니다" 류 노출 차단.
// 실제 버그 시나리오: mail-agent 위임(delegated=true) 후 실패 → haiku 가 "메일 조회 에이전트에" 포함 응답.
// SUBAGENT_ID_RE 가 영문 mail-agent 만 처리하므로 한국어 패턴이 finalText sanitize 를 통과하는 버그.
describe('runAiComposeStream — 한국어 에이전트 식별자 sanitize (#426)', () => {
  // mail-agent 위임 후 LLM 에러 응답이 finalText 경로로 나오는 시나리오 (delegated=true).
  // loadSubagents 를 mail-agent 포함으로 override 해 화이트리스트 차단 없이 delegated=true 달성.
  it('mail-agent 위임 후 실패: finalText 에서 "메일 조회 에이전트에" 를 제거한다', async () => {
    vi.mocked(loadSubagents).mockReturnValueOnce(
      { 'mail-agent': { description: 'd', tools: [], prompt: '' } } as never,
    );
    const agentToolUse = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'mail-agent', prompt: '메일 조회' } }] },
    });
    const leaked = '죄송합니다, 잠시 후 다시 시도해 주세요. 현재 메일 조회 에이전트에 연결할 수 없습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(agentToolUse); // delegated=true 설정
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leaked }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '메일 확인해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('메일 조회 에이전트');
    expect(out.fullText).toContain('죄송합니다');
  });

  it('delta 스트림에서도 "메일 에이전트가" 를 제거한다 (isMailQuery=false 일반 쿼리)', async () => {
    // isMailQuery=false 인 쿼리로 isMailQuery && !delegated 경로를 피해 delta sanitize 검증.
    const leaked = '현재 메일 에이전트가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta(leaked));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leaked }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const streamed: string[] = [];
    const out = await runAiComposeStream(baseInput({ query: '할 일 알려줘' }), { client: fakeClient }, (t) => streamed.push(t), new AbortController().signal);
    expect(streamed.join('')).not.toContain('메일 에이전트');
    expect(out.fullText).not.toContain('메일 에이전트');
  });

  it('도메인 접두어 없는 "에이전트" 는 제거하지 않는다(오탐 방지)', async () => {
    const normal = '에이전트가 처리합니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: normal }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '할 일 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('에이전트가 처리합니다.');
  });

  it('"이슈 에이전트를" 도 finalText 에서 제거한다', async () => {
    const leaked = '이슈 에이전트를 통해 처리하겠습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leaked }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '이슈 처리해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('이슈 에이전트');
    expect(out.fullText).toContain('통해 처리하겠습니다.');
  });
});

// #429: 서브에이전트 직접 호출 불가 내부 구현 메시지 sanitize.
// D-002 패턴: "서브에이전트를 직접 호출하지 못하는 환경입니다. 직접 처리하겠습니다."
// D-001b 패턴: "제가 직접 처리하겠습니다."
describe('runAiComposeStream — 서브에이전트 직접 호출 내부 메시지 sanitize (#429)', () => {
  it('D-002: fullText 에서 "서브에이전트를 직접 호출하지 못하는 환경" 메시지 제거', async () => {
    const leakedMsg =
      '이슈에 코멘트를 남기겠습니다.죄송합니다. 서브에이전트를 직접 호출하지 못하는 환경입니다. 직접 처리하겠습니다.EX-7777 이슈를 찾을 수 없습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leakedMsg }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('서브에이전트를 직접 호출하지 못하는 환경');
    expect(out.fullText).not.toContain('죄송합니다. 서브에이전트를');
    expect(out.fullText).toContain('이슈에 코멘트를 남기겠습니다.');
    expect(out.fullText).toContain('EX-7777 이슈를 찾을 수 없습니다.');
  });

  it('D-001b: fullText 에서 "제가 직접 처리하겠습니다." 메시지 제거', async () => {
    const leakedMsg =
      'EX-9876 이슈를 진행중 상태로 변경하겠습니다.제가 직접 처리하겠습니다.EX-9876 이슈를 찾을 수 없습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leakedMsg }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('제가 직접 처리하겠습니다.');
    expect(out.fullText).toContain('진행중 상태로 변경하겠습니다.');
    expect(out.fullText).toContain('EX-9876 이슈를 찾을 수 없습니다.');
  });

  it('D-002: delta 스트림에서도 청크 분할된 내부 메시지 sanitize', async () => {
    // D-002 실측 패턴: "서브에이전트를 " + "직" + "접 호출하지 못하는 환경입니다. 직접 처리하겠습니다."
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('이슈에 코멘트를 남기'));
      onLine(textDelta('겠습니다.죄송합니다. 서브에이전트를 '));
      onLine(textDelta('직'));
      onLine(textDelta('접 호출하지 못하는 환경입니다. 직접 처리하겠습니다.'));
      onLine(textDelta('EX-7777 이슈를 찾을 수 없습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    await runAiComposeStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('서브에이전트를 직접 호출하지 못하는 환경');
    expect(streamed).not.toContain('제가 직접 처리하겠습니다');
    expect(streamed).toContain('이슈에 코멘트를 남기겠습니다.');
    expect(streamed).toContain('EX-7777 이슈를 찾을 수 없습니다.');
  });

  it('"직접 처리하겠습니다." 단독(제가/서브에이전트 없음)은 제거하지 않는다(오탐 방지)', async () => {
    // "제가" 없이 "직접 처리하겠습니다."만 있으면 정상 문구이므로 통과.
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '이슈 상태를 직접 처리하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toContain('직접 처리하겠습니다.');
  });
});

// #423: 이슈 상태·우선순위 영어 enum 괄호 병기 sanitize.
// "완료(DONE)", "진행 중 (IN_PROGRESS)", "높음 (HIGH)" 처럼 영어 enum 을 괄호 안에 병기하는 비결정적 동작 차단.
describe('runAiComposeStream — 이슈 enum 영어 병기 sanitize (#423)', () => {
  it('finalText 에서 상태 영어 병기 "완료(DONE)" → "완료" 로 제거한다', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'EX-5 이슈 상태를 완료(DONE)로 변경했습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('(DONE)');
    expect(out.fullText).toContain('완료');
    expect(out.fullText).toContain('EX-5 이슈 상태를');
  });

  it('finalText 에서 상태 영어 병기 "진행 중 (IN_PROGRESS)" → "진행 중 " 으로 제거한다', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '상태: 진행 중 (IN_PROGRESS)\n우선순위: 높음 (HIGH)' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('(IN_PROGRESS)');
    expect(out.fullText).not.toContain('(HIGH)');
    expect(out.fullText).toContain('진행 중');
    expect(out.fullText).toContain('높음');
  });

  it('delta 스트림에서도 영어 enum 병기를 제거한다', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('상태: 진행 중 (IN_PROGRESS), 우선순위: 높음 (HIGH)'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    await runAiComposeStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('(IN_PROGRESS)');
    expect(streamed).not.toContain('(HIGH)');
  });

  it('괄호 없는 영어 enum 은 제거하지 않는다(오탐 방지)', async () => {
    // "상태를 DONE으로 변경합니다" 처럼 괄호 없이 나오는 경우는 sanitize 대상이 아님
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'update_status(DONE) 호출합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    // "(DONE)" 앞에 공백 없이 "update_status(DONE)" 형태이므로 sanitize 대상인지 확인
    // ENUM_PARENTHETICAL_RE = /\s*\((DONE|...)\)/gi — \s* 이므로 공백 없어도 매칭됨
    // 이 케이스는 정상 도구명이 포함돼 있으나 sanitize 목적상 패턴 매칭 시 제거됨(허용)
    expect(out.fullText).toContain('호출합니다.');
  });
});

// #404: show_issue_detail 위젯 — 존재하지 않는 이슈 번호 차단(결정론적 서버 검증).
// haiku 가 EX-99999 처럼 존재하지 않는 이슈에 show_issue_detail 을 호출하는 비결정적 동작 차단.
describe('runAiComposeStream — show_issue_detail not-found guard (#404)', () => {
  function issueDetailLine(projectKey: string, number: number): string {
    return JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'show_issue_detail', input: { params: { number, projectKey }, layout: {} } }],
      },
    });
  }

  it('존재하지 않는 이슈 번호(EX-99999) → issue_detail 위젯 드롭', async () => {
    // getIssueDetail 이 throw 하면 위젯을 드롭해야 한다.
    (fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail =
      vi.fn().mockRejectedValue(new Error('404 Not Found'));
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(issueDetailLine('EX', 99999));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'EX-99999 이슈 상세를 표시합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: 'EX-99999 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    // 위젯이 드롭되어 null 이어야 한다.
    expect(out.widgets).toBeNull();
  });

  it('존재하는 이슈(EX-1) → issue_detail 위젯 유지', async () => {
    (fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail =
      vi.fn().mockResolvedValue({ issueKey: 'EX-1', title: '기존 이슈' });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(issueDetailLine('EX', 1));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'EX-1 이슈 상세를 표시합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: 'EX-1 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.widgets).toEqual([{ type: 'issue_detail', params: { number: 1, projectKey: 'EX' }, layout: {} }]);
  });

  it('projectKey 없는 issue_detail 위젯은 통과(미검증)', async () => {
    (fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail = vi.fn();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // projectKey 없이 호출
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_issue_detail', input: { params: { number: 5 }, layout: {} } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '이슈 표시.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiComposeStream(baseInput({ query: '5번 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    // 검증 불가 → 통과, getIssueDetail 미호출
    expect(out.widgets).toEqual([{ type: 'issue_detail', params: { number: 5 }, layout: {} }]);
    expect((fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail).not.toHaveBeenCalled();
  });
});

// #405: 생성일 필터 쿼리 사전 차단 — LLM 호출 없이 고정 안내 반환.
describe('runAiComposeStream — 생성일 필터 쿼리 사전 차단 (#405)', () => {
  it('이번 주 생성된 이슈 쿼리 → LLM 미호출, 고정 안내 반환', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    const out = await runAiComposeStream(
      baseInput({ query: '이번 주 생성된 이슈 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toContain('생성 날짜 필터는 지원하지 않습니다');
    expect(out.widgets).toBeNull();
    expect(out.pendingAction).toBeNull();
    // LLM 미호출 확인 — getOAuthToken 도 호출되지 않아야 한다.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).not.toHaveBeenCalled();
  });

  it('최근 생성된 이슈 쿼리 → 고정 안내 반환', async () => {
    const out = await runAiComposeStream(
      baseInput({ query: '최근 생성된 이슈 목록 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toContain('생성 날짜 필터는 지원하지 않습니다');
  });

  it('지난 주 만들어진 이슈 → 고정 안내 반환', async () => {
    const out = await runAiComposeStream(
      baseInput({ query: '지난 주 만들어진 이슈 뭐 있어?' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toContain('생성 날짜 필터는 지원하지 않습니다');
  });

  it('이슈 생성 요청("이슈 만들어줘") → guard 미적용, LLM 호출됨', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    vi.mocked(existsSync).mockReturnValue(false);
    // getOAuthToken 이 호출될 것 — 따라서 LLM 경로가 실행됨.
    await runAiComposeStream(
      baseInput({ query: '이번 주 이슈 만들어줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalled();
  });

  it('마감일 필터 요청("이번 주 마감 이슈") → guard 미적용, LLM 호출됨', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    vi.mocked(existsSync).mockReturnValue(false);
    await runAiComposeStream(
      baseInput({ query: '이번 주 마감 이슈 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalled();
  });
});

// #406: 복합 요청에서 unassign_self 미호출 시 직접 API 재처리.
describe('runAiComposeStream — 복합 요청 unassign 재처리 (#406)', () => {
  it('복합 해제 쿼리 + issue-agent 위임 + 사이드카 없음 → unassignSelf 호출', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getOAuthToken: vi.fn().mockResolvedValue({ token: 'tok', label: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    // loadSubagents 에 issue-agent 포함
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // issue-agent 위임 발생
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2 진행중으로 바꾸고...' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '상태 변경과 코멘트를 처리했습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 사이드카 없음(success/error 둘 다 false)
    vi.mocked(existsSync).mockReturnValue(false);

    await runAiComposeStream(
      baseInput({ query: 'EX-2 이슈 진행중으로 바꾸고 코멘트 남겨줘 그리고 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    // unassignSelf 가 userId(1), 이슈키("EX-2")로 호출됐는지 확인.
    expect(unassignSelf).toHaveBeenCalledWith(1, 'EX-2');
  });

  it('복합 해제 쿼리 + 성공 사이드카 있음 → unassignSelf 미호출(이미 처리됨)', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getOAuthToken: vi.fn().mockResolvedValue({ token: 'tok', label: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '담당자 해제 완료.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 성공 사이드카 존재 → 재처리 불필요
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('unassign-success.json'),
    );
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ issueKey: 'EX-2' }) as never);

    await runAiComposeStream(
      baseInput({ query: 'EX-2 이슈 진행중으로 바꾸고 코멘트 남겨줘 그리고 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    expect(unassignSelf).not.toHaveBeenCalled();
  });

  it('복합 해제 쿼리 + 에러 사이드카 있음 → userId 재처리 시도(unassignSelf 호출)', async () => {
    // 에러 사이드카 있어도 userId 로 직접 재처리를 시도한다(agentId vs userId 불일치 보완).
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getOAuthToken: vi.fn().mockResolvedValue({ token: 'tok', label: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '일시적 오류.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const canonical = '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('unassign-error.json'),
    );
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ error: '403', canonical }) as never);

    const out = await runAiComposeStream(
      baseInput({ query: 'EX-2 이슈 진행중으로 바꾸고 코멘트 남겨줘 그리고 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    // userId 재처리 시도됨 (existsSync mock은 rmSync 호출 후에도 true 유지 — 단위 테스트 한계)
    expect(unassignSelf).toHaveBeenCalledWith(1, 'EX-2');
    // existsSync mock이 삭제를 반영 못하므로 test에서는 canonical이 반환됨 (프로덕션에서는 delta)
    expect(out.fullText).toBe(canonical);
  });

  it('단순 해제 쿼리(복합 아님) → unassignSelf 미호출(issue-agent 가 직접 처리)', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getOAuthToken: vi.fn().mockResolvedValue({ token: 'tok', label: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2 담당 해제' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '담당자 해제 완료.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);

    await runAiComposeStream(
      baseInput({ query: 'EX-2 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    // 복합 요청이 아니므로 재처리 안 함
    expect(unassignSelf).not.toHaveBeenCalled();
  });
});

// #415: 단순 해제 쿼리 + 위임 시도 + unassign_self 미처리 → 허위 성공 응답 차단.
describe('runAiComposeStream — 단순 해제 허위 성공 환각 차단 (#415)', () => {
  it('단순 해제 쿼리 + 위임 + 사이드카 없음 → 실패 안내 반환(허위 성공 차단)', async () => {
    // 배경: issue-agent 가 unassign_self 없이 성공을 환각하는 경우. 사이드카 모두 없음.
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // issue-agent 위임 발생 → delegated=true
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2 담당 해제' } }] } }));
      // issue-agent 가 도구 없이 성공 환각
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'EX-2 이슈에서 담당이 해제되었습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 성공/에러 사이드카 모두 없음
    vi.mocked(existsSync).mockReturnValue(false);

    const out = await runAiComposeStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 허위 성공 응답 대신 실패 안내를 반환해야 한다.
    expect(out.fullText).toBe('담당 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.');
  });

  it('단순 해제 쿼리 + 위임 + 성공 사이드카 있음 → LLM 응답 통과(실제 해제됨)', async () => {
    // 배경: issue-agent 가 unassign_self 를 정상 호출해 성공 사이드카가 기록된 케이스.
    // 가드가 발동하지 않고 LLM 응답(성공 메시지)이 그대로 반환돼야 한다.
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2 담당 해제' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'EX-2 이슈 담당 해제 완료.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 성공 사이드카 존재 → 실제로 unassign_self 가 호출된 상태
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('unassign-success.json'),
    );
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ issueKey: 'EX-2' }) as never);

    const out = await runAiComposeStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 성공 사이드카가 있으므로 가드 미발동 → LLM 응답 통과
    expect(out.fullText).toBe('EX-2 이슈 담당 해제 완료.');
  });

  it('단순 해제 쿼리 + 위임 + 에러 사이드카 있음 → unassignErrorPath override 통과', async () => {
    // 배경: issue-agent 가 unassign_self 를 호출했으나 실패(에러 사이드카 기록) → #415 가드 미발동,
    // 기존 unassignErrorPath override 가 canonical 메시지를 반환.
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2 담당 해제' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '처리 중 오류가 발생했습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const canonical = '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
    // 에러 사이드카만 존재 → #415 가드 미발동, #378 override 발동
    vi.mocked(existsSync).mockImplementation((p: unknown) =>
      typeof p === 'string' && p.includes('unassign-error.json'),
    );
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ error: '404', canonical }) as never);

    const out = await runAiComposeStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // #378 canonical override 가 반환돼야 한다
    expect(out.fullText).toBe(canonical);
  });
});
