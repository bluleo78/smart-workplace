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
const logMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ log: logMock }));
// mkdtempSync/writeFileSync/rmSync 는 실제 호출 없이 mock 처리해 fs 부작용 제거.
// #333 M2: existsSync/readFileSync 도 mock 추가 — 사이드카 읽기 경로 테스트용.
vi.mock('node:fs', () => ({
  mkdtempSync: vi.fn(() => '/tmp/mock-workdir'),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { runAiChatStream, type ChatInput } from './run-ai-chat.js';
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
function baseInput(over: Partial<ChatInput> = {}): ChatInput {
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

// #381: 답 텍스트는 이제 사이드카 파일(subagent-response.json / router-response.json)에서 온다.
// run-ai-compose 가 readResponseSidecar(existsSync + readFileSync, { text } 모양)로 읽으므로,
// 테스트는 경로-인지(path-aware) mock 으로 각 사이드카 파일의 존재/내용을 시뮬레이션한다.
// (기존 #378/#406/#415 사이드카 테스트가 쓰던 path-keyed existsSync/readFileSync idiom 그대로.)
interface SidecarSpec {
  subagent?: string; // subagent-response.json 의 text (submit_response)
  router?: string; // router-response.json 의 text (respond_chat)
  pendingAction?: unknown; // pending-action.json 의 내용(객체, NDJSON 1줄로 직렬화)
  unassignSuccess?: unknown; // unassign-success.json 의 내용(객체)
  unassignError?: unknown; // unassign-error.json 의 내용(객체)
}
// 지정한 사이드카들만 존재하도록 existsSync/readFileSync 를 경로별로 모킹한다.
function mockSidecars(spec: SidecarSpec): void {
  const files: Array<{ name: string; content: string }> = [];
  if (spec.subagent !== undefined) files.push({ name: 'subagent-response.json', content: JSON.stringify({ text: spec.subagent }) });
  if (spec.router !== undefined) files.push({ name: 'router-response.json', content: JSON.stringify({ text: spec.router }) });
  // #351: NDJSON 형식 — 단일 객체도 줄 1개로 저장(readPendingActions 가 줄 단위로 파싱).
  if (spec.pendingAction !== undefined) files.push({ name: 'pending-action.json', content: JSON.stringify(spec.pendingAction) + '\n' });
  if (spec.unassignSuccess !== undefined) files.push({ name: 'unassign-success.json', content: JSON.stringify(spec.unassignSuccess) });
  if (spec.unassignError !== undefined) files.push({ name: 'unassign-error.json', content: JSON.stringify(spec.unassignError) });
  vi.mocked(existsSync).mockImplementation((p: unknown) =>
    typeof p === 'string' && files.some((f) => p.includes(f.name)),
  );
  vi.mocked(readFileSync).mockImplementation((p: unknown) => {
    if (typeof p === 'string') {
      const hit = files.find((f) => p.includes(f.name));
      if (hit) return hit.content as never;
    }
    return '' as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken =
    vi.fn().mockResolvedValue({ token: 'tok', label: null });
});

describe('runAiChatStream (스트리밍 — SSE 라우트용)', () => {
  // #463: 라우터 자유 prose(text_delta)는 onDelta 로 라이브 emit 된다. onText 는 위임 답(subagent sidecar)에만 사용.
  it('라우터 prose(text_delta)는 onDelta 로 라이브 emit, fullText = 누적 streamedText', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(thinkingDelta('추론 과정')); // thinking_delta — extractRouterTextDelta 가 null 반환(text_delta 아님)
      onLine(textDelta('안녕 ')); // 라우터 prose → onDelta 경유 라이브 emit
      onLine(textDelta('하세요'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '라우터 synthesis prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({}); // 사이드카 없음 — streamedText 가 답
    const got: string[] = []; // onText 수집(라우터 prose 는 오지 않음)
    const deltas: string[] = []; // onDelta 수집
    const result = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    // 라우터 prose 는 onDelta 로만 나가고 onText 는 호출 안 됨.
    expect(got).toHaveLength(0);
    expect(deltas).toEqual(['안녕 ', '하세요']);
    expect(result.fullText).toBe('안녕 하세요'); // streamedText 누적
    // 회귀 가드: 비서 토큰을 요청의 assistantAgentId(7)로 fetch 했는지 검증.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalledWith(7);
  });

  it('done 에서 parseComposeLines 로 widgets 산출 + 위젯만 있으면 fullText 빈 문자열', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // tool_use 라인은 delta 아님 — lines 에만 쌓여 parseComposeLines 가 처리
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '라우터 prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 위젯만 있고 텍스트 없는 케이스 — #463: routerSidecar 제거, 위젯 단독이면 빈 텍스트.
    mockSidecars({});
    const result = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(result.fullText).toBe('');
    expect(result.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  // #463: 라우터 prose(textDelta) 는 사이드카 없이도 직접 onDelta + fullText 로.
  it('라우터 prose(textDelta) 사이드카 없음 → onDelta emit + fullText = 스트리밍 텍스트', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('저는 이슈·메일·일정 등을 도와드릴 수 있어요.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const got: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '뭐 할 수 있어?' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(got).toHaveLength(0); // onText 미호출 — streamedText 는 이미 onDelta 로 나감
    expect(deltas).toEqual(['저는 이슈·메일·일정 등을 도와드릴 수 있어요.']);
    expect(out.fullText).toBe('저는 이슈·메일·일정 등을 도와드릴 수 있어요.');
  });

  // #381 불변식: submit_response(위임) 사이드카 존재 → 답 = 그 text.
  it('submit_response(위임) 사이드카 존재 → 답 = 그 text', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '라우터 synthesis(무시)' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: 'EX-2 이슈를 진행 중으로 변경했어요.' });
    const got: string[] = [];
    const out = await runAiChatStream(baseInput({ query: 'EX-2 진행중으로 바꿔줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got).toEqual(['EX-2 이슈를 진행 중으로 변경했어요.']);
    expect(out.fullText).toBe('EX-2 이슈를 진행 중으로 변경했어요.');
  });

  // #463: subagent 사이드카가 streamedText 보다 우선(위임 답이 라우터 prose 보다 강).
  it('subagent 사이드카는 streamedText 보다 우선 — 위임 답이 onText 로 1회 emit', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: 'SUB 답변' });
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('SUB 답변');
    expect(got).toEqual(['SUB 답변']);
  });

  // #463: 사이드카 없음 + 위젯 없음 + streamedText 없음 → 결정적 fallback.
  it('사이드카 없음 + 위젯 없음 + streamedText 없음 → fallback 텍스트', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // textDelta 를 보내지 않음 — streamedText 가 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({}); // 어떤 사이드카도 없음
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(got).toEqual(['요청을 처리하지 못했어요. 다시 시도해 주세요.']);
  });

  // #381 후속: propose 로 pending_action 은 발행됐으나 submit_response 누락 → fallback 대신 제안 안내.
  it('pending_action 있음 + 응답 사이드카 없음 → 제안 안내 문구(확인 카드 모순 방지)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // propose 핸들러가 pending-action 만 쓰고 submit_response 사이드카는 없는 상황.
    mockSidecars({ pendingAction: { actionType: 'mail.send_mail', summary: 'hong 에게 메일', params: {} } });
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('요청하신 작업을 준비했어요. 확인 카드에서 확인해주세요.');
    expect(got).toEqual(['요청하신 작업을 준비했어요. 확인 카드에서 확인해주세요.']);
    expect(out.pendingActions[0]).toMatchObject({ actionType: 'mail.send_mail' });
  });

  // #381 불변식: 위젯(show_*)만 + 사이드카 없음 → 빈 텍스트(onText 미호출) + widgets 반환.
  it('위젯(show_*)만 + 사이드카 없음 → onText 미호출 + widgets 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'show_my_tasks', input: {} }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got).toHaveLength(0); // 빈 텍스트는 emit 하지 않음
    expect(out.fullText).toBe('');
    expect(out.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  // #463: 서브에이전트 누수 가드 — parent_tool_use_id 있는 text_delta 는 onDelta 로 나가지 않는다.
  it('서브에이전트 누수 가드: parent_tool_use_id 있는 text_delta 는 onDelta 미발행', async () => {
    const subLeak = '서브에이전트 내부 처리 중...';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // parent_tool_use_id 설정 → 서브에이전트 내부 prose → extractRouterTextDelta 가 null 반환
      onLine(JSON.stringify({ type: 'stream_event', parent_tool_use_id: 'tu_sub', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: subLeak } } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '처리했어요.' });
    const got: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    // 서브에이전트 prose 는 onDelta 에 안 나감
    expect(deltas).toHaveLength(0);
    expect(deltas.join('')).not.toContain(subLeak);
    // 위임 답(subagent sidecar)은 onText 로 emit
    expect(got).toEqual(['처리했어요.']);
    expect(out.fullText).toBe('처리했어요.');
  });

  // #463: 위임 프리앰블은 라이브 노출되고 최종 답은 위임 답.
  // 과도한 중복은 프롬프트 가드+라이브 스모크로 관리.
  it('위임 시 라우터 프리앰블 prose 는 onDelta 로 라이브 노출되고 최종 fullText 는 subagent 사이드카 답', async () => {
    const subagentText = '메일함에 3개의 미읽은 메일이 있어요.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // 라우터 자기 prose (parent_tool_use_id 없음 → extractRouterTextDelta 가 텍스트 반환)
      onLine(textDelta('메일을 확인해볼게요'));
      // 위임 tool_use
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'mail-agent', prompt: '미읽은 메일 조회' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'mail-agent': { description: 'm', tools: [], prompt: '' } });
    mockSidecars({ subagent: subagentText });
    const got: string[] = [];    // onText 수집 (위임 답만 도달해야 함)
    const deltas: string[] = []; // onDelta 수집 (프리앰블 prose 가 라이브로 도달해야 함)
    const out = await runAiChatStream(baseInput({ query: '메일 확인해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    // 프리앰블 prose 는 onDelta 로 라이브 노출(의도된 동작)
    expect(deltas).toContain('메일을 확인해볼게요');
    // 최종 fullText 는 subagent 사이드카 답이 우선
    expect(out.fullText).toBe(subagentText);
    // onText 는 위임 답(sidecar)만 1회 emit
    expect(got).toEqual([subagentText]);
  });

  it('includePartialMessages:true 로 buildCliArgs 호출', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const passed = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(passed.includePartialMessages).toBe(true);
  });

  it('CLI 실패(reject) 가 전파되고 temp config 는 정리된다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({
      done: Promise.reject(new Error('cli boom')),
      kill: () => {},
    });
    await expect(
      runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal),
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
    const p = runAiChatStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
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
    const p = runAiChatStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(kill).toHaveBeenCalledOnce();
    resolveDone();
    await p;
  });

  // #421→#381: carry buffer/식별자 sanitize 는 삭제됨. delta 는 어떤 형태든 onText 로 안 나간다.
  // 청크 경계에 걸친 식별자 누출 자체가 구조적으로 불가능(delta 미emit) — 사이드카 답만 나간다.
  it('청크 분할된 라우터 식별자 prose 도 delta 로 안 나가고 사이드카 답만 emit (#381)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('wiki'));                         // 청크 1: 식별자 전반부
      onLine(textDelta('-agent에 위임하겠습니다. '));     // 청크 2: 식별자 후반부 + 조사
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '위키 페이지를 찾았어요.' });
    const got: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toMatch(/wiki-agent|agent에|위임하겠습니다/);
    expect(streamed).toBe('위키 페이지를 찾았어요.');
  });
});

describe('runAiChatStream (서브에이전트 통합 #333)', () => {
  it('assistant 프로파일 + allowSubagents + systemPromptPath 로 spawn 준비', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
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
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal, (l) => labels.push(l));
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
      runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal),
    ).rejects.toThrow(/blocked by policy/);
    expect(kill).toHaveBeenCalled();
  });

  it('pendingActionPath 를 mcp-config 에 주입한다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const cfgArg = vi.mocked(writeTempMcpConfig).mock.calls[0][0];
    expect(typeof cfgArg.pendingActionPath).toBe('string');
    expect(cfgArg.pendingActionPath).toContain('pending-action.json');
  });

  it('사이드카가 있으면 done 후 읽어 pendingActions 로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '제안했어요.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(true);
    // #351: NDJSON 1줄 — readPendingActions 가 split('\n') 후 파싱.
    vi.mocked(readFileSync).mockReturnValue((JSON.stringify({ actionType: 'calendar.create_event', summary: 's', params: { title: 't' } }) + '\n') as never);
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.pendingActions[0]).toMatchObject({ actionType: 'calendar.create_event', summary: 's' });
  });

  it('사이드카가 없으면 pendingActions 는 빈 배열', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.pendingActions).toEqual([]);
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

    const p = runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);

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
describe('runAiChatStream — unassignError 사이드카 override (#378)', () => {
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
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(canonical);
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('unassign-error.json 이 없으면 subagent 사이드카 답을 그대로 사용', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 에러 사이드카 없음 + 성공 사이드카 + subagent 답 존재 → override 미발동, 사이드카 답 사용.
    mockSidecars({ unassignSuccess: { issueKey: 'EX-2' }, subagent: '담당자 해제 완료.' });
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('담당자 해제 완료.');
  });

  it('unassignErrorPath 를 mcp-config 에 주입한다', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    vi.mocked(existsSync).mockReturnValue(false);
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const cfgArg = vi.mocked(writeTempMcpConfig).mock.calls[0][0];
    expect(typeof cfgArg.unassignErrorPath).toBe('string');
    expect(cfgArg.unassignErrorPath).toContain('unassign-error.json');
  });
});

// #383→#381: mail 직접-응답 fallback override 는 삭제됨. 메일은 위임 → submit_response 사이드카로 답한다.
describe('runAiChatStream — mail 위임 답 / 미위임 fallback (#381, ex-#383)', () => {
  it('메일 쿼리 + 위임 없음 + streamedText 없음 + 사이드카 없음 → 결정적 fallback', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // #463: textDelta 없음 — streamedText 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const labels: string[] = [];
    const streamed: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '메일 계정 연동 상태 확인해줘' }),
      { client: fakeClient },
      (t) => streamed.push(t),
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('메일 쿼리 + 위임 있음 → submit_response 사이드카 답 반환', async () => {
    // mail-agent 를 화이트리스트에 포함시켜 checkSubagentWhitelist 차단을 방지.
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'mail-agent': { description: 'm', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'mail-agent', prompt: '계정 확인' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '메일 계정: test@example.com' });
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '메일 계정 연동 상태 확인해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('메일 계정: test@example.com');
  });

  it('비메일 쿼리 + 위임 없음 + streamedText → prose 답 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('안녕하세요.')); // #463: textDelta → streamedText → fullText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '오늘 할 일 알려줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('안녕하세요.');
  });

  // #385/#408→#381: 연락처 컨텍스트 + 이메일 키워드 → contacts-agent 위임 + 사이드카 답.
  it('연락처 쿼리에 이메일 포함 + contacts-agent 위임 → 위임 라벨 + 사이드카 답', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'contacts-agent': { description: 'c', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'contacts-agent', prompt: '김민수 이메일 kim@test.com 연락처 추가' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '김민수(kim@test.com) 연락처가 추가되었습니다.' });
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '김민수 이메일은 kim@test.com 인데 연락처에 추가해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(labels).toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('김민수(kim@test.com) 연락처가 추가되었습니다.');
  });

  it('순수 "이메일" 키워드 + 위임 없음 + streamedText 없음 + 사이드카 없음 → fallback', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // #463: textDelta 없음 — streamedText 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '이메일 안 읽은 거 확인해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).not.toContain('메일 전문가에게 위임 중');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  // #439→#463: 라우터가 위임 없이 prose 를 스트리밍하면 그것이 그대로 답이 된다(streamedText).
  it('#439→#463: 라우터 미읽은 메일 prose → streamedText 가 fullText, onText 미호출', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('현재 받은편지함에 미읽은 메일이 없습니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '현재 받은편지함에 미읽은 메일이 없습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const streamed: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '미읽은 메일 요약해줘' }),
      { client: fakeClient },
      (t) => streamed.push(t),
      new AbortController().signal,
      undefined, undefined,
      (t) => deltas.push(t),
    );
    // onText 는 미호출 — 라우터 prose 는 이미 onDelta 로 나감
    expect(streamed).toHaveLength(0);
    expect(deltas).toEqual(['현재 받은편지함에 미읽은 메일이 없습니다.']);
    expect(out.fullText).toBe('현재 받은편지함에 미읽은 메일이 없습니다.');
  });

  // #439→#381: 위임 확정 후 mail-agent 답은 submit_response 사이드카로 도착(토큰 스트리밍 없음, done 후 1회).
  it('#439: 위임 확정 후 mail-agent 답은 사이드카에서 done 후 1회 emit', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'mail-agent': { description: 'm', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'mail-agent', prompt: '미읽은 메일 조회' } }] } }));
      onLine(textDelta('받은편지함에 5개의 미읽은 메일이 있습니다.')); // delta — emit 금지
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '받은편지함에 5개의 미읽은 메일이 있습니다.' });
    const streamed: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '미읽은 메일 요약해줘' }),
      { client: fakeClient },
      (t) => streamed.push(t),
      new AbortController().signal,
    );
    expect(streamed).toEqual(['받은편지함에 5개의 미읽은 메일이 있습니다.']);
    expect(out.fullText).toBe('받은편지함에 5개의 미읽은 메일이 있습니다.');
  });
});

// #408→#381: contacts 직접-응답 fallback override 는 삭제됨. 연락처는 위임 → 사이드카로 답한다.
describe('runAiChatStream — contacts 위임 답 / 미위임 fallback (#381, ex-#408)', () => {
  it('연락처 쿼리 + 위임 없음 + streamedText 없음 + 사이드카 없음 → fallback', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // #463: textDelta 없음 — streamedText 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const labels: string[] = [];
    const streamed: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '연락처 찾아줘' }),
      { client: fakeClient },
      (t) => streamed.push(t),
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).not.toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('연락처 쿼리 + 위임 있음 → submit_response 사이드카 답 반환', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'contacts-agent': { description: 'c', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'contacts-agent', prompt: '연락처 찾아줘' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '현재 등록된 연락처가 없습니다.' });
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '연락처 찾아줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('현재 등록된 연락처가 없습니다.');
  });

  it('비연락처 쿼리 + 위임 없음 + streamedText → prose 답 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('안녕하세요.')); // #463: textDelta → streamedText → fullText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '오늘 일정 알려줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    expect(labels).not.toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('안녕하세요.');
  });
});

// #390→#381: drive 미지원-작업 고정 override 는 삭제됨. "미지원" 안내는 이제 subagent 가 사이드카로 답하고,
// 라우터가 위임 없이 prose 로 답하면 그 prose 는 버려지고 fallback 이 반환된다.
describe('runAiChatStream — drive 위임 답 / 미위임 fallback (#381, ex-#390)', () => {
  it('파일 업로드 쿼리 + 위임 + 사이드카 "미지원" → 사이드카 답 반환', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'drive-agent': { description: 'dr', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'drive-agent', prompt: '업로드' } }] } }));
      onLine(textDelta('이 정보를 알려주시면 drive-agent에 위임하여 업로드를 진행하겠습니다.')); // delta — emit 금지
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '파일 업로드 기능은 현재 지원하지 않습니다.' });
    const out = await runAiChatStream(
      baseInput({ query: '드라이브에 새 파일 보고서.pdf를 업로드해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('파일 업로드 기능은 현재 지원하지 않습니다.');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('드라이브 멤버 권한 변경 쿼리 + 위임 없음 + streamedText 없음 → fallback', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // #463: textDelta 없음 — streamedText 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(
      baseInput({ query: '드라이브 팀 스페이스에 홍길동 멤버 추가해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('드라이브 파일 조회 쿼리(지원 기능) + 위임 → 사이드카 답 그대로 반환', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'drive-agent': { description: 'dr', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'drive-agent', prompt: '파일 목록' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '드라이브 파일 목록입니다.' });
    const out = await runAiChatStream(
      baseInput({ query: '팀 드라이브 파일 목록 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('드라이브 파일 목록입니다.');
    expect(out.fullText).not.toBe('현재 지원하지 않는 기능입니다.');
  });

  // #419: 파일명에 'upload'가 포함된 삭제 쿼리("test-upload.txt 삭제해줘")는 drive.delete_file 지원 범위.
  // isDriveUnsupportedQuery 의 deny 패턴 'upload'가 파일명에 오탐하지 않도록 allow-list 에 '삭제' 추가.
  it('파일명에 upload 포함 삭제 쿼리 → guard 미적용, pendingActions 반환', async () => {
    // #351: NDJSON 1줄
    const sidecarContent = JSON.stringify({ actionType: 'drive.delete_file', summary: '드라이브 내 "test-upload.txt" 삭제', params: { fileId: 1 } }) + '\n';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('파일을 찾았습니다. 삭제를 제안합니다.'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '파일을 찾았습니다. 삭제를 제안합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 사이드카 존재 — propose_delete_file 이 기록한 pending-action.
    vi.mocked(existsSync).mockImplementation((p) => typeof p === 'string' && p.endsWith('pending-action.json'));
    vi.mocked(readFileSync).mockReturnValue(sidecarContent);
    const out = await runAiChatStream(
      baseInput({ query: '드라이브에서 test-upload.txt 파일을 삭제해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // "현재 지원하지 않는 기능" 으로 override 되면 안 됨.
    expect(out.fullText).not.toBe('현재 지원하지 않는 기능입니다.');
    // propose_delete_file 이 기록한 사이드카가 pendingActions 배열로 반환되어야 함.
    expect(out.pendingActions[0]).toMatchObject({ actionType: 'drive.delete_file' });
  });
});

// #436→#381: wiki 삭제 미지원 고정 override 는 삭제됨. "미지원" 안내는 wiki-agent 가 사이드카로 답한다.
describe('runAiChatStream — wiki 위임 답 / 미위임 fallback (#381, ex-#436)', () => {
  it('위키 페이지 삭제 쿼리 + 위임 + 사이드카 "미지원" → 사이드카 답 반환', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'wiki-agent': { description: 'w', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'wiki-agent', prompt: '삭제' } }] } }));
      onLine(textDelta('위키 페이지 삭제 요청을 전달하겠습니다.')); // delta — emit 금지
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '위키 페이지 삭제 기능은 현재 지원하지 않습니다.' });
    const out = await runAiChatStream(
      baseInput({ query: '위키 페이지 삭제해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('위키 페이지 삭제 기능은 현재 지원하지 않습니다.');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('위키 페이지 지워줘 쿼리 + 위임 없음 + streamedText 없음 → fallback', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // #463: textDelta 없음 — streamedText 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(
      baseInput({ query: '위키 "프로젝트 소개" 페이지 지워줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('위키 페이지 검색 쿼리(지원 기능) + 위임 → 사이드카 답 그대로 반환', async () => {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'wiki-agent': { description: 'w', tools: [], prompt: '' } });
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'wiki-agent', prompt: '검색' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '프로젝트 소개 페이지를 찾았습니다.' });
    const out = await runAiChatStream(
      baseInput({ query: '위키에서 프로젝트 소개 찾아줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('프로젝트 소개 페이지를 찾았습니다.');
    expect(out.fullText).not.toBe('위키 페이지 삭제 기능은 현재 지원하지 않습니다.');
  });
});

// #400 #409: 비가역 작업 제안 후 승인 발화 시 haiku 환각 응답 차단 — pending_action 없이 "완료했습니다" 방지.
describe('runAiChatStream — proposal approval hallucination guard (#400, #409)', () => {
  it('승인 발화 + 직전 AI 제안 문구 + pendingActions 없음 → 고정 안내 반환', async () => {
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
    const out = await runAiChatStream(
      baseInput({ query: '네, 승인합니다', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // haiku 환각 응답 대신 고정 안내가 반환되어야 한다.
    expect(out.fullText).toContain('확인 카드에서 승인해주세요');
    expect(out.fullText).not.toContain('생성됐습니다');
    expect(out.pendingActions).toEqual([]);
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
    const out = await runAiChatStream(
      baseInput({ query: '네', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // pending_action 이 있으면 정상적으로 pendingActions 배열이 비어있지 않아야 한다.
    expect(out.pendingActions.length).toBeGreaterThan(0);
  });

  it('일반 쿼리("네 알겠어")는 제안 컨텍스트 없으면 guard 미적용(streamedText 답 통과)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('안녕하세요.')); // #463: textDelta → streamedText → fullText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 제안 컨텍스트 없음 → guard 미발동, streamedText 답이 그대로 반환.
    mockSidecars({});
    const out = await runAiChatStream(
      baseInput({ query: '네 알겠어', recentContext: [] }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('안녕하세요.');
    expect(out.fullText).not.toContain('확인 카드에서 승인해주세요');
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
    const out = await runAiChatStream(
      baseInput({ query: '확인', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 환각 차단 — 고정 안내가 반환되어야 한다.
    expect(out.fullText).toContain('확인 카드에서 승인해주세요');
    expect(out.fullText).not.toContain('완료했습니다');
    expect(out.pendingActions).toEqual([]);
  });
});

// #376: runAiChatStream 이 userId 를 buildChildEnv 에 전달하는지 검증.
describe('runAiChatStream — userId → ACTING_USER_ID 전달 (#376)', () => {
  it('ChatInput.userId 를 buildChildEnv 4번째 인자로 전달한다', async () => {
    // done 을 즉시 resolve 하는 스트림 mock — resolveDone 할당 타이밍 문제 없음.
    vi.mocked(runClaudeCliStream).mockImplementation(() => ({
      done: Promise.resolve(),
      kill: vi.fn(),
    }));

    await runAiChatStream(
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

// #379/#407→#381: SDK 내부-메시지 정규식 override 는 삭제됨. 라우터 SDK-leak prose 는 result/delta 로 와도
// 사용자에게 안 나간다(구조적). 답은 사이드카(없으면 fallback)에서만 온다.
describe('runAiChatStream — SDK 내부 메시지 누수 가드 (#381, ex-#379/#407)', () => {
  it('라우터 result 에 SDK-leak prose 가 있어도 fullText 는 fallback (prose 미사용)', async () => {
    const sdkLeak = '현재 환경에서 Agent 도구가 활성화되어 있지 않네요. 이슈 삭제는 불가합니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: sdkLeak }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: 'EX-5 이슈를 삭제해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(out.fullText).not.toContain('Agent 도구가 활성화');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('이슈 삭제 거부 안내는 subagent 사이드카 답으로 그대로 반환', async () => {
    const normalResp = '이슈 삭제는 지원하지 않습니다. 상태를 CANCELED로 변경하거나, 웹 화면에서 직접 삭제해 주세요.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: '삭제' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: normalResp });
    const out = await runAiChatStream(baseInput({ query: 'EX-5 이슈를 삭제해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(normalResp);
  });

  it('#407 advisor 폴백 prose(result)도 fullText 는 fallback (prose 미사용)', async () => {
    const sdkLeak = '문제가 발생했습니다. 현재 일정 관련 도구가 활성화되지 않았습니다. advisor에게 상담하겠습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: sdkLeak }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: '일정 삭제 취소해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(out.fullText).not.toContain('advisor');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('정상 안내는 streamedText(textDelta) 로 그대로 반환', async () => {
    const normalResp = '일정 삭제 취소는 확인 카드를 무시하시면 됩니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta(normalResp)); // #463: textDelta → streamedText → fullText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: '일정 삭제 취소해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(normalResp);
  });
});

// #410→#381: 내부 식별자 sanitize 정규식은 삭제됨. 라우터가 result/delta 에 "calendar-agent에" 류를 노출해도
// 그 prose 는 사용자에게 안 나간다(구조적). 답은 사이드카에서만 온다.
describe('runAiChatStream — 내부 식별자 누수 가드 (#381, ex-#410)', () => {
  it('라우터 result 의 calendar-agent 식별자 prose 는 fullText 로 안 나간다 → fallback', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'calendar-agent에 확인하겠습니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: '이번 주 화요일 빈 시간 있어?' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('calendar-agent');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('라우터 result 의 contacts-agent 식별자 prose 는 fullText 로 안 나간다', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'contacts-agent가 처리합니다.' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: '연락처 찾아줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('contacts-agent');
  });

  it('정상 답은 streamedText(textDelta) 로 그대로 반환(식별자 없음)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('일정을 확인하겠습니다.')); // #463: textDelta → streamedText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: '오늘 일정 알려줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('일정을 확인하겠습니다.');
  });
});

// #426→#381: 한국어 식별자 sanitize 정규식은 삭제됨. 라우터의 "메일 조회 에이전트에" 류 prose 는
// result/delta 어디에 와도 사용자에게 안 나간다(구조적). 위임 실패 답은 subagent 사이드카로만 온다.
describe('runAiChatStream — 한국어 에이전트 식별자 누수 가드 (#381, ex-#426)', () => {
  it('mail-agent 위임 후 실패: 라우터 result prose 미사용, subagent 사이드카 답 반환', async () => {
    vi.mocked(loadSubagents).mockReturnValueOnce(
      { 'mail-agent': { description: 'd', tools: [], prompt: '' } } as never,
    );
    const agentToolUse = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'mail-agent', prompt: '메일 조회' } }] },
    });
    const leaked = '죄송합니다. 현재 메일 조회 에이전트에 연결할 수 없습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(agentToolUse); // delegated=true 설정
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leaked }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // subagent 가 식별자 없는 안내를 사이드카에 기록.
    mockSidecars({ subagent: '죄송합니다, 잠시 후 다시 시도해 주세요.' });
    const out = await runAiChatStream(baseInput({ query: '메일 확인해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('메일 조회 에이전트');
    expect(out.fullText).toBe('죄송합니다, 잠시 후 다시 시도해 주세요.');
  });

  it('#426→#463: 라우터 textDelta 는 onDelta 로 emit — streamed(onText) 에는 안 나간다', async () => {
    // #463: textDelta 는 onDelta 로 라이브 emit 됨. onText(streamed) 에는 도달 안 함.
    const prose = '오늘 할 일 목록을 보여드릴게요.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta(prose));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: prose }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const streamed: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '할 일 알려줘' }), { client: fakeClient }, (t) => streamed.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(streamed).toHaveLength(0); // onText 는 미호출
    expect(deltas).toContain(prose);  // onDelta 로 emit 됨
    expect(out.fullText).toBe(prose); // streamedText 가 fullText
  });

  it('정상 답(식별자 없음)은 streamedText 로 그대로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('에이전트가 처리합니다.')); // #463: textDelta → streamedText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: '할 일 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('에이전트가 처리합니다.');
  });
});

// #429→#381: "서브에이전트 직접 호출 불가" 내부 메시지 sanitize 는 삭제됨.
// 그 내부 prose 는 result/delta 어디에 와도 사용자에게 안 나간다(구조적). 답은 사이드카에서만 온다.
describe('runAiChatStream — 서브에이전트 직접 호출 내부 메시지 누수 가드 (#381, ex-#429)', () => {
  it('D-002: 라우터 result 의 "직접 호출하지 못하는 환경" prose 는 fullText 로 안 나감 → 사이드카 답', async () => {
    const leakedMsg =
      '이슈에 코멘트를 남기겠습니다.죄송합니다. 서브에이전트를 직접 호출하지 못하는 환경입니다. 직접 처리하겠습니다.EX-7777 이슈를 찾을 수 없습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leakedMsg }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: 'EX-7777 이슈를 찾을 수 없습니다.' });
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('서브에이전트를 직접 호출하지 못하는 환경');
    expect(out.fullText).toBe('EX-7777 이슈를 찾을 수 없습니다.');
  });

  it('D-001b: 라우터 result 의 "제가 직접 처리하겠습니다." prose 는 fullText 로 안 나감 → 사이드카 답', async () => {
    const leakedMsg =
      'EX-9876 이슈를 진행중 상태로 변경하겠습니다.제가 직접 처리하겠습니다.EX-9876 이슈를 찾을 수 없습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leakedMsg }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: 'EX-9876 이슈를 찾을 수 없습니다.' });
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('제가 직접 처리하겠습니다.');
    expect(out.fullText).toBe('EX-9876 이슈를 찾을 수 없습니다.');
  });

  it('D-002: delta(청크 분할) 내부 메시지도 사용자에게 안 나간다(전부 버려짐)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('이슈에 코멘트를 남기'));
      onLine(textDelta('겠습니다.죄송합니다. 서브에이전트를 '));
      onLine(textDelta('직'));
      onLine(textDelta('접 호출하지 못하는 환경입니다. 직접 처리하겠습니다.'));
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: 'EX-7777 이슈를 찾을 수 없습니다.' });
    const got: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('서브에이전트를 직접 호출하지 못하는 환경');
    expect(streamed).not.toContain('직접 처리하겠습니다');
    expect(streamed).toBe('EX-7777 이슈를 찾을 수 없습니다.');
  });

  it('정상 답("직접 처리하겠습니다." 정상 문장)은 사이드카로 그대로 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '이슈 상태를 직접 처리하겠습니다.' });
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('이슈 상태를 직접 처리하겠습니다.');
  });
});

// #441→#381: project-agent delta 의 "Agent 도구가 없으므로" 내부 SDK 메시지 sanitize 는 삭제됨.
// 그 delta prose 는 어떤 청크 형태든 사용자에게 안 나간다(구조적). 답은 사이드카에서만 온다.
describe('runAiChatStream — Agent 도구 없음 내부 메시지 누수 가드 (#381, ex-#441)', () => {
  it('delta(단일 청크)의 "Agent 도구가 없으므로" prose 는 안 나가고 사이드카 답만 emit', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('저는 `Agent` 도구가 없으므로 직접 처리하겠습니다.'));
      onLine(textDelta('프로젝트 설명 수정 기능은 현재 지원하지 않습니다.'));
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'project-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'project-agent': { description: 'p', tools: [], prompt: '' } });
    mockSidecars({ subagent: '프로젝트 설명 수정 기능은 현재 지원하지 않습니다.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'EX 프로젝트 설명 변경해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('`Agent` 도구가 없으므로');
    expect(streamed).not.toContain('저는 `Agent`');
    expect(streamed).toBe('프로젝트 설명 수정 기능은 현재 지원하지 않습니다.');
  });

  it('pj-r13-003: 청크 분할(delta 1~3)된 내부 메시지도 안 나가고 사이드카 답만 emit', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('저는 `Agent`'));
      onLine(textDelta(' 도구가 없으므로'));
      onLine(textDelta(' 직접 처리하겠습니다.'));
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'project-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'project-agent': { description: 'p', tools: [], prompt: '' } });
    mockSidecars({ subagent: '프로젝트 설명 수정 기능은 현재 지원하지 않습니다.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'EX 프로젝트 설명 변경해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('`Agent` 도구가 없으므로');
    expect(streamed).toBe('프로젝트 설명 수정 기능은 현재 지원하지 않습니다.');
  });

  it('라우터 result 의 "Agent 도구가 없으므로" prose 도 fullText 로 안 나감 → fallback', async () => {
    const leakedText = '저는 `Agent` 도구가 없으므로 직접 처리하겠습니다.프로젝트 설명 수정 기능은 현재 지원하지 않습니다.';
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: leakedText }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput({ query: 'EX 프로젝트 설명 변경해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('`Agent` 도구가 없으므로');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });
});

// #423→#381: 이슈 enum 영어 괄호 병기 sanitize 정규식은 삭제됨.
// 라우터 prose 는 사용자에게 안 나가고(구조적), 답은 subagent 사이드카가 작성한 텍스트 그대로다.
// (subagent 가 한국어로만 쓰면 영어 병기 자체가 없다 — sanitize 불필요.)
describe('runAiChatStream — 이슈 enum 답은 사이드카 그대로 (#381, ex-#423)', () => {
  it('subagent 사이드카에 한국어 상태 답 → 그대로 반환(영어 병기 없음)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'x' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'EX-5 이슈 상태를 완료(DONE)로 변경했습니다.' })); // 라우터 prose — 무시
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: 'EX-5 이슈 상태를 완료로 변경했습니다.' });
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('(DONE)');
    expect(out.fullText).toBe('EX-5 이슈 상태를 완료로 변경했습니다.');
  });

  it('라우터 result 에 영어 병기 prose 가 있어도 사이드카 없으면 fallback(병기 미노출)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '상태: 진행 중 (IN_PROGRESS)\n우선순위: 높음 (HIGH)' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('(IN_PROGRESS)');
    expect(out.fullText).not.toContain('(HIGH)');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('delta 의 영어 병기 prose 도 사용자에게 안 나간다(전부 버려짐)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('상태: 진행 중 (IN_PROGRESS), 우선순위: 높음 (HIGH)'));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: '' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '상태: 진행 중, 우선순위: 높음' });
    const got: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('(IN_PROGRESS)');
    expect(streamed).not.toContain('(HIGH)');
    expect(streamed).toBe('상태: 진행 중, 우선순위: 높음');
  });

  it('streamedText 에 도구명 류 텍스트가 있으면 그대로 보존(sanitize 없음)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('update_status(DONE) 호출합니다.')); // #463: textDelta → streamedText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('update_status(DONE) 호출합니다.');
  });
});

// #404: show_issue_detail 위젯 — 존재하지 않는 이슈 번호 차단(결정론적 서버 검증).
// haiku 가 EX-99999 처럼 존재하지 않는 이슈에 show_issue_detail 을 호출하는 비결정적 동작 차단.
describe('runAiChatStream — show_issue_detail not-found guard (#404)', () => {
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
    const out = await runAiChatStream(baseInput({ query: 'EX-99999 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
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
    const out = await runAiChatStream(baseInput({ query: 'EX-1 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
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
    const out = await runAiChatStream(baseInput({ query: '5번 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    // 검증 불가 → 통과, getIssueDetail 미호출
    expect(out.widgets).toEqual([{ type: 'issue_detail', params: { number: 5 }, layout: {} }]);
    expect((fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail).not.toHaveBeenCalled();
  });
});

// #405: 생성일 필터 쿼리 사전 차단 — LLM 호출 없이 고정 안내 반환.
describe('runAiChatStream — 생성일 필터 쿼리 사전 차단 (#405)', () => {
  it('이번 주 생성된 이슈 쿼리 → LLM 미호출, 고정 안내 반환', async () => {
    vi.mocked(runClaudeCliStream).mockReturnValue({ done: Promise.resolve(), kill: () => {} });
    const out = await runAiChatStream(
      baseInput({ query: '이번 주 생성된 이슈 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toContain('생성 날짜 필터는 지원하지 않습니다');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
    // LLM 미호출 확인 — getOAuthToken 도 호출되지 않아야 한다.
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).not.toHaveBeenCalled();
  });

  it('최근 생성된 이슈 쿼리 → 고정 안내 반환', async () => {
    const out = await runAiChatStream(
      baseInput({ query: '최근 생성된 이슈 목록 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toContain('생성 날짜 필터는 지원하지 않습니다');
  });

  it('지난 주 만들어진 이슈 → 고정 안내 반환', async () => {
    const out = await runAiChatStream(
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
    await runAiChatStream(
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
    await runAiChatStream(
      baseInput({ query: '이번 주 마감 이슈 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect((fakeClient as { getOAuthToken: ReturnType<typeof vi.fn> }).getOAuthToken).toHaveBeenCalled();
  });
});

// #406: 복합 요청에서 unassign_self 미호출 시 직접 API 재처리.
describe('runAiChatStream — 복합 요청 unassign 재처리 (#406)', () => {
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

    await runAiChatStream(
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

    await runAiChatStream(
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

    const out = await runAiChatStream(
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

    await runAiChatStream(
      baseInput({ query: 'EX-2 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    // 복합 요청이 아니므로 재처리 안 함
    expect(unassignSelf).not.toHaveBeenCalled();
  });
});

// #440->#381: 홈 라우터 위임 preamble("위임하겠습니다." 등) delta sanitize(정규식/버퍼)는 전부 삭제됨.
// 라우터의 위임 preamble/추론 prose 는 어떤 변형/청크 형태든 사용자에게 안 나간다(구조적 불변식).
// 위임 답은 drive-agent 의 submit_response 사이드카로만, 미위임이면 fallback 으로 온다.
describe('runAiChatStream — 홈 라우터 위임 preamble 누수 가드 (#381, ex-#440)', () => {
  // drive-agent 를 화이트리스트에 포함하는 헬퍼(차단 없이 delegated=true 달성).
  function allowDrive(): void {
    vi.mocked(loadSubagents).mockReturnValue({ 'issue-agent': { description: 'd', tools: [], prompt: '' }, 'drive-agent': { description: 'dr', tools: [], prompt: '' } });
  }
  const driveDelegation = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'drive-agent', prompt: '파일 삭제' } }] },
  });

  it('"위임하겠습니다." preamble delta 는 사용자에게 안 나가고 사이드카 답만 emit', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('위임하겠습니다.'));
      onLine(driveDelegation);
      onLine(textDelta('"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.')); // delta — emit 금지
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' });
    const got: string[] = [];
    const labels: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, (l) => labels.push(l));
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하겠습니다.');
    expect(streamed).toBe('"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.');
    expect(labels).toContain('드라이브 전문가에게 위임 중');
  });

  it('"드라이브에서 ... 직접 찾아 처리하겠습니다." 변형 preamble 도 안 나간다', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('위임하겠습니다.드라이브에서 파일을 직접 찾아 처리하겠습니다.'));
      onLine(driveDelegation);
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하겠습니다.');
    expect(streamed).not.toContain('직접 찾아 처리하겠습니다.');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
  });

  it('"드라이브에서 직접 폴더를 찾아보겠습니다." 추론 preamble 도 안 나간다', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('드라이브에서 "업무문서" 폴더를 찾아 삭제를 진행하겠습니다.드라이브에서 직접 폴더를 찾아보겠습니다.'));
      onLine(driveDelegation);
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더 삭제 제안을 등록했습니다. 확인 후 승인하시면 삭제됩니다.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: '"업무문서" 폴더 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('찾아 삭제를 진행하겠습니다.');
    expect(streamed).not.toContain('직접 폴더를 찾아보겠습니다.');
    expect(streamed).toContain('폴더 삭제 제안을 등록했습니다.');
  });

  it('최종 응답 문장은 사이드카 답으로 그대로 보존(오탐 방지)', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(driveDelegation);
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' });
    const got: string[] = [];
    const out = await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got.join('')).toContain('삭제를 제안했습니다.');
    expect(out.fullText).toContain('삭제를 제안했습니다.');
  });

  it('회귀: "위임하여 ... 진행합니다." 변형 preamble 도 안 나간다', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('위임하여 파일을 찾고 삭제를 진행합니다.'));
      onLine(driveDelegation);
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하여');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
  });

  it('회귀: "찾아 삭제를 제안합니다." 변형 preamble 도 안 나간다', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('드라이브에서 파일을 직접 찾아 삭제를 제안합니다.'));
      onLine(driveDelegation);
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('직접 찾아 삭제를 제안합니다.');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
  });

  it('회귀: 청크 분할된 preamble 도 안 나간다(carry 경계 불필요)', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('"업무문서" 폴더를 찾았습니다. 삭제를 제안합니')); // 청크1
      onLine(textDelta('다.')); // 청크2(경계)
      onLine(driveDelegation);
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더 삭제 제안을 등록했습니다. 확인 후 승인하시면 삭제됩니다.' });
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: '"업무문서" 폴더 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('찾았습니다. 삭제를 제안합니다.');
    expect(streamed).toContain('폴더 삭제 제안을 등록했습니다.');
  });

  it('drive 쿼리 + 위임 미발생 + streamedText 없음 → fallback 1회(onText)', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      // #463: textDelta 없음 — streamedText 비어서 fallback 발동
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got).toHaveLength(1);
    expect(got[0]).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('drive 쿼리 + drive-agent 위임 확정 → preamble 미노출 + 사이드카 답 + progress 라벨', async () => {
    allowDrive();
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('위임하겠습니다.'));
      onLine(driveDelegation); // 위임 확정 → delegated=true
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({ subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' });
    const got: string[] = [];
    const labels: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, (l) => labels.push(l));
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하겠습니다.');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
    expect(labels).toContain('드라이브 전문가에게 위임 중');
  });

  it('비드라이브 인사 쿼리 → streamedText(textDelta) 답 반환', async () => {
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(textDelta('안녕하세요. 무엇을 도와드릴까요?')); // #463: textDelta → streamedText
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    mockSidecars({});
    const got: string[] = []; // onText — streamedText 는 onDelta 경유라 got 에 없음
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '안녕하세요' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(out.fullText).toBe('안녕하세요. 무엇을 도와드릴까요?');
    expect(deltas.join('')).toContain('안녕하세요. 무엇을 도와드릴까요?');
  });
});


// #415: 단순 해제 쿼리 + 위임 시도 + unassign_self 미처리 → 허위 성공 응답 차단.
describe('runAiChatStream — 단순 해제 허위 성공 환각 차단 (#415)', () => {
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

    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 허위 성공 응답 대신 실패 안내를 반환해야 한다.
    expect(out.fullText).toBe('담당 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.');
  });

  it('단순 해제 쿼리 + 위임 + 성공 사이드카 있음 → subagent 사이드카 답 통과(실제 해제됨)', async () => {
    // 배경: issue-agent 가 unassign_self 를 정상 호출해 성공 사이드카가 기록된 케이스.
    // #415 가드가 발동하지 않고 subagent submit_response 답(성공 메시지)이 그대로 반환돼야 한다.
    vi.mocked(runClaudeCliStream).mockImplementation((_i, onLine) => {
      onLine(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Agent', input: { subagent_type: 'issue-agent', prompt: 'EX-2 담당 해제' } }] } }));
      onLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'prose' }));
      return { done: Promise.resolve(), kill: () => {} };
    });
    // 성공 사이드카 존재(실제 해제됨) + subagent 답 사이드카.
    mockSidecars({ unassignSuccess: { issueKey: 'EX-2' }, subagent: 'EX-2 이슈 담당 해제 완료.' });

    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // 성공 사이드카가 있으므로 가드 미발동 → subagent 사이드카 답 통과
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

    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // #378 canonical override 가 반환돼야 한다
    expect(out.fullText).toBe(canonical);
  });
});

describe('runAiChatStream 로그', () => {
  beforeEach(() => {
    logMock.info.mockClear();
    logMock.warn.mockClear();
    logMock.error.mockClear();
  });

  it('생성일 필터 쿼리는 fallback(reason=created_date_filter_blocked) 을 발행한다', async () => {
    const deps = { client: { getOAuthToken: vi.fn() } } as never;
    await runAiChatStream(
      {
        query: '이번 주 생성된 이슈 보여줘',
        assistantAgentId: 2,
        userId: 1,
        model: 'claude-sonnet-4-6',
        thinkingDepth: 'NORMAL',
        maxTurns: 8,
        timeoutMs: 1000,
        requestId: 'rq1',
      },
      deps,
      () => {},
      new AbortController().signal,
    );
    expect(logMock.warn).toHaveBeenCalledWith(
      'ai-chat',
      'fallback',
      expect.objectContaining({ requestId: 'rq1', reason: 'created_date_filter_blocked' }),
    );
  });
});
