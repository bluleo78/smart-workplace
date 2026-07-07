import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunnerEvent } from './runner-events.js';
import type { RunnerInput } from './agent-runner.js';

// Task 6: stream 경로 RunnerEvent 이관. runSdkStream/buildInProcessWorkplaceMcpServer mock 대신
// agent-runner(runnerFor().stream) 를 mock 하고 RunnerEvent 픽스처를 onEvent 로 흘린다.
// hostBridge/onTool 는 stream 입력의 i.mcp 로 전달되므로, mock impl 이 거기서 콜백을 구동한다.
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));
const logMock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../logger.js', () => ({ log: logMock }));

import { runAiChatStream, type ChatInput } from './run-ai-chat.js';

const fakeClient = {
  getProviderCredential: vi.fn(),
  // #404: show_issue_detail 위젯 존재 여부 검증 — 기본값은 존재(resolve).
  getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-1', title: 't' }),
} as never;

// 비서 설정은 요청 본문으로 온다. 테스트용 기본 입력.
function baseInput(over: Partial<ChatInput> = {}): ChatInput {
  return {
    query: '내 할 일',
    assistantAgentId: 7,
    userId: 1,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'NORMAL',
    maxTurns: 8,
    timeoutMs: 60_000,
    ...over,
  };
}

// RunnerEvent 픽스처 헬퍼.
function textDelta(text: string, parentToolUseId: string | null = null): RunnerEvent {
  return { type: 'text_delta', text, parentToolUseId };
}
function agentDelegation(subagentType: string): RunnerEvent {
  return { type: 'tool_use', name: 'Agent', input: { subagent_type: subagentType, prompt: 'x' }, parentToolUseId: null };
}
function toolUse(name: string, input: unknown): RunnerEvent {
  return { type: 'tool_use', name, input, parentToolUseId: null };
}
function result(text = ''): RunnerEvent {
  return { type: 'result', ok: true, text, usage: null };
}

// 사이드카(HostBridge) 시뮬레이션 스펙.
interface SidecarSpec {
  subagent?: string;
  pendingAction?: { actionType: string; summary: string; params: Record<string, unknown> };
  unassignSuccess?: unknown;
  unassignError?: { canonical: string };
}

// spec 에 따라 onEvent 발행 직전에 bridge 콜백(i.mcp.hostBridge)을 호출하는 stream 구현을 반환한다.
function makeRunnerImpl(events: RunnerEvent[], spec: SidecarSpec = {}) {
  return (i: RunnerInput, onEvent: (e: RunnerEvent) => void) => {
    const bridge = i.mcp?.hostBridge;
    if (spec.subagent !== undefined) bridge?.onSubmitResponse(spec.subagent);
    if (spec.pendingAction !== undefined) bridge?.onProposal(spec.pendingAction);
    if (spec.unassignSuccess !== undefined) bridge?.onUnassignResult({ ok: true });
    if (spec.unassignError !== undefined) bridge?.onUnassignResult({ ok: false, canonical: spec.unassignError.canonical });
    for (const ev of events) onEvent(ev);
    return { done: Promise.resolve(), kill: () => {} };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  streamSpy.mockReset();
  (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
    vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null });
});

describe('runAiChatStream (스트리밍 — SSE 라우트용)', () => {
  // #463: 라우터 자유 prose(text_delta)는 onDelta 로 라이브 emit 된다. onText 는 위임 답에만 사용.
  it('라우터 prose(text_delta)는 onDelta 로 라이브 emit, fullText = 누적 streamedText', async () => {
    // thinking 델타는 RunnerEvent 로 매핑되지 않으므로 픽스처에서 제외(text_delta 만 사용자에게 흐른다).
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('안녕 '),
      textDelta('하세요'),
      result(''),
    ]));
    const got: string[] = [];
    const deltas: string[] = [];
    const outcome = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    // 라우터 prose 는 onDelta 로만 나가고 onText 는 호출 안 됨.
    expect(got).toHaveLength(0);
    expect(deltas).toEqual(['안녕 ', '하세요']);
    expect(outcome.fullText).toBe('안녕 하세요');
    // 비서 토큰을 assistantAgentId(7)로 fetch 했는지 검증.
    expect((fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential).toHaveBeenCalledWith(7);
  });

  it('모델 결정: input.model(요청 body)이 credential.model 보다 우선한다', async () => {
    (fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential =
      vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: 'claude-opus-4-1' });
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const passed = vi.mocked(streamSpy).mock.calls[0][0] as { model: string };
    expect(passed.model).toBe('claude-sonnet-4-6'); // input.model 그대로(body 우선)
  });

  it('done 에서 parseChatEvents 로 widgets 산출 + 위젯만 있으면 fullText 빈 문자열', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      toolUse('show_my_tasks', {}),
      result(''),
    ]));
    const outcome = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(outcome.fullText).toBe('');
    expect(outcome.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  it('라우터 prose(textDelta) 사이드카 없음 → onDelta emit + fullText = 스트리밍 텍스트', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('저는 이슈·메일·일정 등을 도와드릴 수 있어요.'),
      result(''),
    ]));
    const got: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '뭐 할 수 있어?' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(got).toHaveLength(0);
    expect(deltas).toEqual(['저는 이슈·메일·일정 등을 도와드릴 수 있어요.']);
    expect(out.fullText).toBe('저는 이슈·메일·일정 등을 도와드릴 수 있어요.');
  });

  // #381 불변식: submit_response(위임) → HostBridge.onSubmitResponse → 답 = 그 text.
  it('submit_response(위임) HostBridge 콜백 → 답 = 그 text', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { subagent: 'EX-2 이슈를 진행 중으로 변경했어요.' }));
    const got: string[] = [];
    const out = await runAiChatStream(baseInput({ query: 'EX-2 진행중으로 바꿔줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got).toEqual(['EX-2 이슈를 진행 중으로 변경했어요.']);
    expect(out.fullText).toBe('EX-2 이슈를 진행 중으로 변경했어요.');
  });

  // #463: subagent 답이 streamedText 보다 우선.
  it('subagent 답은 streamedText 보다 우선 — 위임 답이 onText 로 1회 emit', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { subagent: 'SUB 답변' }));
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('SUB 답변');
    expect(got).toEqual(['SUB 답변']);
  });

  // #463: 사이드카 없음 + 위젯 없음 + streamedText 없음 → 결정적 fallback.
  it('사이드카 없음 + 위젯 없음 + streamedText 없음 → fallback 텍스트', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(got).toEqual(['요청을 처리하지 못했어요. 다시 시도해 주세요.']);
  });

  // #381 후속: propose 로 pending_action 은 발행됐으나 submit_response 누락 → 제안 안내.
  it('pending_action 있음 + 응답 사이드카 없음 → 제안 안내 문구(확인 카드 모순 방지)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')], { pendingAction: { actionType: 'mail.send_mail', summary: 'hong 에게 메일', params: {} } }));
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('요청하신 작업을 준비했어요. 확인 카드에서 확인해주세요.');
    expect(got).toEqual(['요청하신 작업을 준비했어요. 확인 카드에서 확인해주세요.']);
    expect(out.pendingActions[0]).toMatchObject({ actionType: 'mail.send_mail' });
  });

  // #381 불변식: 위젯(show_*)만 + 사이드카 없음 → 빈 텍스트(onText 미호출) + widgets 반환.
  it('위젯(show_*)만 + 사이드카 없음 → onText 미호출 + widgets 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      toolUse('show_my_tasks', {}),
      result(''),
    ]));
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got).toHaveLength(0);
    expect(out.fullText).toBe('');
    expect(out.widgets).toEqual([{ type: 'my_tasks', params: {} }]);
  });

  // #463: 서브에이전트 누수 가드 — parentToolUseId 있는 text_delta 는 onDelta 로 나가지 않는다.
  it('서브에이전트 누수 가드: parentToolUseId 있는 text_delta 는 onDelta 미발행', async () => {
    const subLeak = '서브에이전트 내부 처리 중...';
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta(subLeak, 'tu_sub'),
      result(''),
    ], { subagent: '처리했어요.' }));
    const got: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(deltas).toHaveLength(0);
    expect(deltas.join('')).not.toContain(subLeak);
    expect(got).toEqual(['처리했어요.']);
    expect(out.fullText).toBe('처리했어요.');
  });

  // #463: 위임 프리앰블은 라이브 노출되고 최종 답은 위임 답.
  it('위임 시 라우터 프리앰블 prose 는 onDelta 로 라이브 노출되고 최종 fullText 는 subagent 답', async () => {
    const subagentText = '메일함에 3개의 미읽은 메일이 있어요.';
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('메일을 확인해볼게요'),
      agentDelegation('mail-agent'),
      result(''),
    ], { subagent: subagentText }));
    const got: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '메일 확인해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(deltas).toContain('메일을 확인해볼게요');
    expect(out.fullText).toBe(subagentText);
    expect(got).toEqual([subagentText]);
  });

  it('includePartialMessages:true 로 stream 호출', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    const passed = streamSpy.mock.calls[0][0];
    expect(passed.includePartialMessages).toBe(true);
  });

  // Fix 1: allowFileRead:false — 홈 컴포즈는 파일 읽기 불필요(보안 최소권한).
  it('allowFileRead:false 로 stream 호출', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(streamSpy.mock.calls[0][0].allowFileRead).toBe(false);
  });

  // Fix 4: userId passthrough — 요청 userId 가 stream 에 그대로 전달되는지 검증.
  it('userId passthrough — baseInput({ userId: 42 }) → stream.userId === 42', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput({ userId: 42 }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(streamSpy.mock.calls[0][0].userId).toBe(42);
  });

  // #376: 인-프로세스 MCP 도구 principal = 요청자(userId), agentId 아님.
  // stdio 서버(workplace-mcp-server.ts)와 동일: onBehalfOfId = userId ?? agentId.
  // userId(42) 와 assistantAgentId(7) 를 달리 설정해 실제로 구분하는지 검증(mcp 설정으로 러너에 전달).
  it('#376 mcp.onBehalfOfId principal = 요청자 userId(42), assistantAgentId(7) 아님', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(
      baseInput({ assistantAgentId: 7, userId: 42 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    const mcp = streamSpy.mock.calls[0][0].mcp;
    expect(mcp.onBehalfOfId).toBe(42);
    expect(mcp.onBehalfOfId).not.toBe(7);
  });

  // #719: tenantId 가 있으면 withOnBehalfOfTenant 로 스코프한 클라이언트를 mcp.client 로 넘겨야 한다.
  // 서브에이전트도 이 인스턴스를 공유하므로(claude-sdk-runner.ts 의 단일 MCP 서버) 위임 도구 호출까지
  // 한 번에 커버된다 — 요청자가 다중/무 멤버십일 때 AgentTenantResolver 가 fail-closed 되는 것을 막는다.
  it('#719 tenantId 있으면 withOnBehalfOfTenant 로 스코프한 클라이언트를 mcp.client 로 전달', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const scopedClient = { scoped: true } as never;
    const withOnBehalfOfTenant = vi.fn().mockReturnValue(scopedClient);
    const clientWithTenant = {
      getProviderCredential: vi.fn(),
      getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-1', title: 't' }),
      withOnBehalfOfTenant,
    } as never;
    await runAiChatStream(
      baseInput({ tenantId: 7 }),
      { client: clientWithTenant },
      () => {},
      new AbortController().signal,
    );
    expect(withOnBehalfOfTenant).toHaveBeenCalledWith(7);
    expect(streamSpy.mock.calls[0][0].mcp.client).toBe(scopedClient);
  });

  // #719: tenantId 가 없으면(null/undefined) 원본 클라이언트를 그대로 써야 한다 — 불필요한 스코프 생성 방지.
  it('#719 tenantId 없으면 원본 클라이언트를 그대로 mcp.client 로 전달', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(streamSpy.mock.calls[0][0].mcp.client).toBe(fakeClient);
  });

  // #467: 과거 first-write-guard 는 onSubmitResponse 가 두 번 호출되면 첫 답만 남기고 두 번째를
  // 조용히 버렸다(한 턴 멀티 위임 시 두 번째 이후 서브에이전트 답 누락). 이제는 순서대로 결합한다.
  it('#467 onSubmitResponse 두 번 호출(멀티 위임) → 두 답 모두 순서대로 결합된 fullText', async () => {
    streamSpy.mockImplementation((i: RunnerInput) => {
      i.mcp?.hostBridge?.onSubmitResponse('첫 답');
      i.mcp?.hostBridge?.onSubmitResponse('둘째 답');
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(out.fullText).toBe('첫 답\n\n둘째 답');
    // 결합된 답은 onText 로 1회만 emit — 중간 답이 별도로 새 나가지 않는다.
    expect(got).toEqual(['첫 답\n\n둘째 답']);
  });

  // #467: 실제 시나리오(한 턴에 채널 공지 + 이슈 코멘트처럼 서로 다른 도메인 2 위임) 재현 —
  // 두 Agent 위임이 각각 submit_response 로 답을 제출하면 두 답 모두 최종 답에 살아남아야 한다.
  it('#467 한 턴에 2개 서브에이전트로 위임 → 각 subagent 답이 모두 fullText 에 포함', async () => {
    // makeRunnerImpl 은 subagent 스펙 1건만 지원하므로, 실제 멀티 서브에이전트는 직접 구성한다.
    streamSpy.mockImplementation((i: RunnerInput, onEvent: (e: RunnerEvent) => void) => {
      const bridge = i.mcp?.hostBridge;
      onEvent(agentDelegation('messaging-agent'));
      bridge?.onSubmitResponse('채널에 공지를 올렸어요.');
      onEvent(agentDelegation('issue-agent'));
      bridge?.onSubmitResponse('이슈에 코멘트를 남겼어요.');
      onEvent(result(''));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const got: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '채널에 공지 올리고 EX-1 에 코멘트도 남겨줘' }),
      { client: fakeClient },
      (t) => got.push(t),
      new AbortController().signal,
    );
    expect(out.fullText).toBe('채널에 공지를 올렸어요.\n\n이슈에 코멘트를 남겼어요.');
    expect(got).toEqual(['채널에 공지를 올렸어요.\n\n이슈에 코멘트를 남겼어요.']);
  });

  it('SDK 실패(reject) 가 전파된다', async () => {
    streamSpy.mockReturnValue({ done: Promise.reject(new Error('sdk boom')), kill: () => {} });
    await expect(
      runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal),
    ).rejects.toThrow('sdk boom');
  });

  it('스트리밍 중 abort(addEventListener 경로) → handle.kill 호출', async () => {
    const kill = vi.fn();
    let resolveDone!: () => void;
    streamSpy.mockReturnValue({
      done: new Promise<void>((r) => { resolveDone = r; }),
      kill,
    });
    const ac = new AbortController();
    const p = runAiChatStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
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
    ac.abort();
    const p = runAiChatStream(baseInput(), { client: fakeClient }, () => {}, ac.signal);
    await new Promise((r) => setTimeout(r, 0));
    expect(kill).toHaveBeenCalledOnce();
    resolveDone();
    await p;
  });

  // #421→#381: 청크 분할된 라우터 식별자 prose 도 delta 로 안 나가고 사이드카 답만 emit.
  it('청크 분할된 라우터 식별자 prose 도 delta 로 안 나가고 사이드카 답만 emit (#381)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('wiki'),
      textDelta('-agent에 위임하겠습니다. '),
      agentDelegation('issue-agent'),
      result(''),
    ], { subagent: '위키 페이지를 찾았어요.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toMatch(/wiki-agent|agent에|위임하겠습니다/);
    expect(streamed).toBe('위키 페이지를 찾았어요.');
  });
});

describe('runAiChatStream (서브에이전트 통합 #333)', () => {
  it('assistant 프로파일(mcp) + allowSubagents 로 stream 호출', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    // mcp 설정에 assistant 프로파일 전달 확인(러너가 인-프로세스 서버를 이 프로필로 구성).
    const arg = streamSpy.mock.calls[0][0];
    expect(arg.mcp.profile).toBe('assistant');
    // allowSubagents:true 전달 확인(러너가 subagent 정의를 구성).
    expect(arg.allowSubagents).toBe(true);
  });

  it('Agent(issue-agent) tool_use → onProgress 로 위임 라벨 발행', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ]));
    const labels: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal, (l) => labels.push(l));
    expect(labels).toContain('이슈 전문가에게 위임 중');
  });

  it('pendingActions — HostBridge.onProposal 콜백으로 누산된 배열 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')], { pendingAction: { actionType: 'calendar.create_event', summary: 's', params: { title: 't' } } }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.pendingActions[0]).toMatchObject({ actionType: 'calendar.create_event', summary: 's' });
  });

  it('pendingActions — onProposal 콜백 없으면 빈 배열', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.pendingActions).toEqual([]);
  });
});

// #378: unassign_self 실패 HostBridge 콜백 override — haiku 재해석 차단.
describe('runAiChatStream — unassignError HostBridge override (#378)', () => {
  it('onUnassignResult({ok:false,canonical}) 콜백 → LLM 응답을 버리고 canonical 로 override', async () => {
    const canonical = '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
    streamSpy.mockImplementation(makeRunnerImpl([result('일시적 장애가 발생했습니다.')], { unassignError: { canonical } }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(canonical);
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
  });

  it('onUnassignResult 콜백 없으면 subagent 답을 그대로 사용', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { unassignSuccess: {}, subagent: '담당자 해제 완료.' }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('담당자 해제 완료.');
  });
});

// #383→#381: mail 직접-응답 fallback override 는 삭제됨.
describe('runAiChatStream — mail 위임 답 / 미위임 fallback (#381, ex-#383)', () => {
  it('메일 쿼리 + 위임 없음 + streamedText 없음 + 사이드카 없음 → 결정적 fallback', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
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

  it('메일 쿼리 + 위임 있음 → submit_response 답 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('mail-agent'),
      result(''),
    ], { subagent: '메일 계정: test@example.com' }));
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
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('안녕하세요.'),
      result(''),
    ]));
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

  it('연락처 쿼리에 이메일 포함 + contacts-agent 위임 → 위임 라벨 + 사이드카 답', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('contacts-agent'),
      result(''),
    ], { subagent: '김민수(kim@test.com) 연락처가 추가되었습니다.' }));
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
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
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

  it('#439→#463: 라우터 미읽은 메일 prose → streamedText 가 fullText, onText 미호출', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('현재 받은편지함에 미읽은 메일이 없습니다.'),
      result(''),
    ]));
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
    expect(streamed).toHaveLength(0);
    expect(deltas).toEqual(['현재 받은편지함에 미읽은 메일이 없습니다.']);
    expect(out.fullText).toBe('현재 받은편지함에 미읽은 메일이 없습니다.');
  });

  it('#439: 위임 확정 후 mail-agent 답은 HostBridge 콜백에서 done 후 1회 emit', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('mail-agent'),
      textDelta('받은편지함에 5개의 미읽은 메일이 있습니다.'),
      result(''),
    ], { subagent: '받은편지함에 5개의 미읽은 메일이 있습니다.' }));
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

describe('runAiChatStream — contacts 위임 답 / 미위임 fallback (#381, ex-#408)', () => {
  it('연락처 쿼리 + 위임 없음 + streamedText 없음 + 사이드카 없음 → fallback', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
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

  it('연락처 쿼리 + 위임 있음 → submit_response 답 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('contacts-agent'),
      result(''),
    ], { subagent: '현재 등록된 연락처가 없습니다.' }));
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
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('안녕하세요.'),
      result(''),
    ]));
    const labels: string[] = [];
    const out = await runAiChatStream(
      baseInput({ query: '오늘 일정 알려줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
      (l) => labels.push(l),
    );
    // 복원: 연락처 위임 라벨이 오발행되지 않는지 확인(원본 #381 불변식).
    expect(labels).not.toContain('연락처 전문가에게 위임 중');
    expect(out.fullText).toBe('안녕하세요.');
  });
});

describe('runAiChatStream — drive 위임 답 / 미위임 fallback (#381, ex-#390)', () => {
  it('파일 업로드 쿼리 + 위임 + 사이드카 "미지원" → 사이드카 답 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('drive-agent'),
      textDelta('이 정보를 알려주시면 drive-agent에 위임하여 업로드를 진행하겠습니다.'),
      result(''),
    ], { subagent: '파일 업로드 기능은 현재 지원하지 않습니다.' }));
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
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const out = await runAiChatStream(
      baseInput({ query: '드라이브 팀 스페이스에 홍길동 멤버 추가해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('드라이브 파일 조회 쿼리(지원 기능) + 위임 → 사이드카 답 그대로 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('drive-agent'),
      result(''),
    ], { subagent: '드라이브 파일 목록입니다.' }));
    const out = await runAiChatStream(
      baseInput({ query: '팀 드라이브 파일 목록 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('드라이브 파일 목록입니다.');
    expect(out.fullText).not.toBe('현재 지원하지 않는 기능입니다.');
  });

  it('파일명에 upload 포함 삭제 쿼리 → guard 미적용, pendingActions 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('파일을 찾았습니다. 삭제를 제안합니다.'),
      result(''),
    ], { pendingAction: { actionType: 'drive.delete_file', summary: '드라이브 내 "test-upload.txt" 삭제', params: { fileId: 1 } } }));
    const out = await runAiChatStream(
      baseInput({ query: '드라이브에서 test-upload.txt 파일을 삭제해줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).not.toBe('현재 지원하지 않는 기능입니다.');
    expect(out.pendingActions[0]).toMatchObject({ actionType: 'drive.delete_file' });
  });
});

describe('runAiChatStream — wiki 위임 답 / 미위임 fallback (#381, ex-#436)', () => {
  it('위키 페이지 삭제 쿼리 + 위임 + 사이드카 "미지원" → 사이드카 답 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('wiki-agent'),
      textDelta('위키 페이지 삭제 요청을 전달하겠습니다.'),
      result(''),
    ], { subagent: '위키 페이지 삭제 기능은 현재 지원하지 않습니다.' }));
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
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const out = await runAiChatStream(
      baseInput({ query: '위키 "프로젝트 소개" 페이지 지워줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('위키 페이지 검색 쿼리(지원 기능) + 위임 → 사이드카 답 그대로 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('wiki-agent'),
      result(''),
    ], { subagent: '프로젝트 소개 페이지를 찾았습니다.' }));
    const out = await runAiChatStream(
      baseInput({ query: '위키에서 프로젝트 소개 찾아줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('프로젝트 소개 페이지를 찾았습니다.');
  });
});

// #400 #409: 비가역 작업 제안 후 승인 발화 시 haiku 환각 응답 차단.
describe('runAiChatStream — proposal approval hallucination guard (#400, #409)', () => {
  it('승인 발화 + 직전 AI 제안 문구 + pendingActions 없음 → 고정 안내 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('팀 회의 일정이 생성됐습니다. 오늘 오후 4시~5시에 예약되어 있습니다.'),
      result(''),
    ])); // onProposal 콜백 없음
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
    expect(out.fullText).toContain('확인 카드에서 승인해주세요');
    expect(out.fullText).not.toContain('생성됐습니다');
    expect(out.pendingActions).toEqual([]);
  });

  it('승인 발화이지만 pending_action 이 있으면 정상 흐름 통과', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')], { pendingAction: { actionType: 'calendar.create_event', summary: '4시 팀 회의', params: {} } }));
    const recentContext = [
      { role: 'ASSISTANT', content: '팀 회의 제안했습니다. 확인 카드에서 승인해주세요.' },
    ];
    const out = await runAiChatStream(
      baseInput({ query: '네', recentContext }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.pendingActions.length).toBeGreaterThan(0);
  });

  it('일반 쿼리("네 알겠어")는 제안 컨텍스트 없으면 guard 미적용(streamedText 답 통과)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('안녕하세요.'),
      result(''),
    ]));
    const out = await runAiChatStream(
      baseInput({ query: '네 알겠어', recentContext: [] }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('안녕하세요.');
    expect(out.fullText).not.toContain('확인 카드에서 승인해주세요');
  });

  it('#409 연락처 삭제 제안("삭제하겠습니다. 확인해주세요") 후 승인 → 고정 안내 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('김철수 연락처 삭제를 완료했습니다.'),
      result(''),
    ]));
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
    expect(out.fullText).toContain('확인 카드에서 승인해주세요');
    expect(out.fullText).not.toContain('완료했습니다');
    expect(out.pendingActions).toEqual([]);
  });
});

// #379/#407→#381: SDK 내부-메시지 정규식 override 는 삭제됨.
describe('runAiChatStream — SDK 내부 메시지 누수 가드 (#381, ex-#379/#407)', () => {
  it('라우터 result 에 SDK-leak prose 가 있어도 fullText 는 fallback (prose 미사용)', async () => {
    const sdkLeak = '현재 환경에서 Agent 도구가 활성화되어 있지 않네요. 이슈 삭제는 불가합니다.';
    streamSpy.mockImplementation(makeRunnerImpl([result(sdkLeak)]));
    const out = await runAiChatStream(baseInput({ query: 'EX-5 이슈를 삭제해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(out.fullText).not.toContain('Agent 도구가 활성화');
  });

  it('이슈 삭제 거부 안내는 subagent 답으로 그대로 반환', async () => {
    const normalResp = '이슈 삭제는 지원하지 않습니다. 상태를 CANCELED로 변경하거나, 웹 화면에서 직접 삭제해 주세요.';
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { subagent: normalResp }));
    const out = await runAiChatStream(baseInput({ query: 'EX-5 이슈를 삭제해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(normalResp);
  });

  it('#407 advisor 폴백 prose(result)도 fullText 는 fallback (prose 미사용)', async () => {
    const sdkLeak = '문제가 발생했습니다. 현재 일정 관련 도구가 활성화되지 않았습니다. advisor에게 상담하겠습니다.';
    streamSpy.mockImplementation(makeRunnerImpl([result(sdkLeak)]));
    const out = await runAiChatStream(baseInput({ query: '일정 삭제 취소해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
    expect(out.fullText).not.toContain('advisor');
  });

  it('정상 안내는 streamedText(textDelta) 로 그대로 반환', async () => {
    const normalResp = '일정 삭제 취소는 확인 카드를 무시하시면 됩니다.';
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta(normalResp),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput({ query: '일정 삭제 취소해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe(normalResp);
  });
});

describe('runAiChatStream — 내부 식별자 누수 가드 (#381, ex-#410)', () => {
  it('라우터 result 의 calendar-agent 식별자 prose 는 fullText 로 안 나간다 → fallback', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('calendar-agent에 확인하겠습니다.')]));
    const out = await runAiChatStream(baseInput({ query: '이번 주 화요일 빈 시간 있어?' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('calendar-agent');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('라우터 result 의 contacts-agent 식별자 prose 는 fullText 로 안 나간다', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('contacts-agent가 처리합니다.')]));
    const out = await runAiChatStream(baseInput({ query: '연락처 찾아줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('contacts-agent');
  });

  it('정상 답은 streamedText(textDelta) 로 그대로 반환(식별자 없음)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('일정을 확인하겠습니다.'),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput({ query: '오늘 일정 알려줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('일정을 확인하겠습니다.');
  });
});

describe('runAiChatStream — 한국어 에이전트 식별자 누수 가드 (#381, ex-#426)', () => {
  it('mail-agent 위임 후 실패: 라우터 result prose 미사용, subagent 답 반환', async () => {
    const leaked = '죄송합니다. 현재 메일 조회 에이전트에 연결할 수 없습니다.';
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('mail-agent'),
      result(leaked),
    ], { subagent: '죄송합니다, 잠시 후 다시 시도해 주세요.' }));
    const out = await runAiChatStream(baseInput({ query: '메일 확인해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('메일 조회 에이전트');
    expect(out.fullText).toBe('죄송합니다, 잠시 후 다시 시도해 주세요.');
  });

  it('#426→#463: 라우터 textDelta 는 onDelta 로 emit — streamed(onText) 에는 안 나간다', async () => {
    const prose = '오늘 할 일 목록을 보여드릴게요.';
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta(prose),
      result(''),
    ]));
    const streamed: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '할 일 알려줘' }), { client: fakeClient }, (t) => streamed.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(streamed).toHaveLength(0);
    expect(deltas).toContain(prose);
    expect(out.fullText).toBe(prose);
  });

  it('정상 답(식별자 없음)은 streamedText 로 그대로 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('에이전트가 처리합니다.'),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput({ query: '할 일 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('에이전트가 처리합니다.');
  });
});

describe('runAiChatStream — 서브에이전트 직접 호출 내부 메시지 누수 가드 (#381, ex-#429)', () => {
  it('D-002: 라우터 result 의 "직접 호출하지 못하는 환경" prose 는 fullText 로 안 나감 → 사이드카 답', async () => {
    const leakedMsg =
      '이슈에 코멘트를 남기겠습니다.죄송합니다. 서브에이전트를 직접 호출하지 못하는 환경입니다. 직접 처리하겠습니다.EX-7777 이슈를 찾을 수 없습니다.';
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(leakedMsg),
    ], { subagent: 'EX-7777 이슈를 찾을 수 없습니다.' }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('서브에이전트를 직접 호출하지 못하는 환경');
    expect(out.fullText).toBe('EX-7777 이슈를 찾을 수 없습니다.');
  });

  it('D-001b: 라우터 result 의 "제가 직접 처리하겠습니다." prose 는 fullText 로 안 나감 → 사이드카 답', async () => {
    const leakedMsg =
      'EX-9876 이슈를 진행중 상태로 변경하겠습니다.제가 직접 처리하겠습니다.EX-9876 이슈를 찾을 수 없습니다.';
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(leakedMsg),
    ], { subagent: 'EX-9876 이슈를 찾을 수 없습니다.' }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('제가 직접 처리하겠습니다.');
    expect(out.fullText).toBe('EX-9876 이슈를 찾을 수 없습니다.');
  });

  it('D-002: delta(청크 분할) 내부 메시지도 사용자에게 안 나간다(전부 버려짐)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('이슈에 코멘트를 남기'),
      textDelta('겠습니다.죄송합니다. 서브에이전트를 '),
      textDelta('직'),
      textDelta('접 호출하지 못하는 환경입니다. 직접 처리하겠습니다.'),
      agentDelegation('issue-agent'),
      result(''),
    ], { subagent: 'EX-7777 이슈를 찾을 수 없습니다.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('서브에이전트를 직접 호출하지 못하는 환경');
    expect(streamed).not.toContain('직접 처리하겠습니다');
    expect(streamed).toBe('EX-7777 이슈를 찾을 수 없습니다.');
  });

  it('정상 답("직접 처리하겠습니다." 정상 문장)은 사이드카로 그대로 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')], { subagent: '이슈 상태를 직접 처리하겠습니다.' }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('이슈 상태를 직접 처리하겠습니다.');
  });
});

describe('runAiChatStream — Agent 도구 없음 내부 메시지 누수 가드 (#381, ex-#441)', () => {
  it('delta(단일 청크)의 "Agent 도구가 없으므로" prose 는 안 나가고 사이드카 답만 emit', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('저는 `Agent` 도구가 없으므로 직접 처리하겠습니다.'),
      textDelta('프로젝트 설명 수정 기능은 현재 지원하지 않습니다.'),
      agentDelegation('project-agent'),
      result(''),
    ], { subagent: '프로젝트 설명 수정 기능은 현재 지원하지 않습니다.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'EX 프로젝트 설명 변경해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('`Agent` 도구가 없으므로');
    expect(streamed).toBe('프로젝트 설명 수정 기능은 현재 지원하지 않습니다.');
  });

  it('pj-r13-003: 청크 분할(delta 1~3)된 내부 메시지도 안 나가고 사이드카 답만 emit', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('저는 `Agent`'),
      textDelta(' 도구가 없으므로'),
      textDelta(' 직접 처리하겠습니다.'),
      agentDelegation('project-agent'),
      result(''),
    ], { subagent: '프로젝트 설명 수정 기능은 현재 지원하지 않습니다.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'EX 프로젝트 설명 변경해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('`Agent` 도구가 없으므로');
    expect(streamed).toBe('프로젝트 설명 수정 기능은 현재 지원하지 않습니다.');
  });

  it('라우터 result 의 "Agent 도구가 없으므로" prose 도 fullText 로 안 나감 → fallback', async () => {
    const leakedText = '저는 `Agent` 도구가 없으므로 직접 처리하겠습니다.프로젝트 설명 수정 기능은 현재 지원하지 않습니다.';
    streamSpy.mockImplementation(makeRunnerImpl([result(leakedText)]));
    const out = await runAiChatStream(baseInput({ query: 'EX 프로젝트 설명 변경해줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('`Agent` 도구가 없으므로');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });
});

describe('runAiChatStream — 이슈 enum 답은 사이드카 그대로 (#381, ex-#423)', () => {
  it('subagent 사이드카에 한국어 상태 답 → 그대로 반환(영어 병기 없음)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result('EX-5 이슈 상태를 완료(DONE)로 변경했습니다.'),
    ], { subagent: 'EX-5 이슈 상태를 완료로 변경했습니다.' }));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('(DONE)');
    expect(out.fullText).toBe('EX-5 이슈 상태를 완료로 변경했습니다.');
  });

  it('라우터 result 에 영어 병기 prose 가 있어도 사이드카 없으면 fallback(병기 미노출)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('상태: 진행 중 (IN_PROGRESS)\n우선순위: 높음 (HIGH)')]));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).not.toContain('(IN_PROGRESS)');
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('delta 의 영어 병기 prose 도 사용자에게 안 나간다(전부 버려짐)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('상태: 진행 중 (IN_PROGRESS), 우선순위: 높음 (HIGH)'),
      result(''),
    ], { subagent: '상태: 진행 중, 우선순위: 높음' }));
    const got: string[] = [];
    await runAiChatStream(baseInput(), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('(IN_PROGRESS)');
    expect(streamed).toBe('상태: 진행 중, 우선순위: 높음');
  });

  it('streamedText 에 도구명 류 텍스트가 있으면 그대로 보존(sanitize 없음)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('update_status(DONE) 호출합니다.'),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.fullText).toBe('update_status(DONE) 호출합니다.');
  });
});

// #404: show_issue_detail 위젯 — 존재하지 않는 이슈 번호 차단.
describe('runAiChatStream — show_issue_detail not-found guard (#404)', () => {
  function issueDetail(projectKey: string, number: number): RunnerEvent {
    return toolUse('show_issue_detail', { params: { number, projectKey }, layout: {} });
  }

  it('존재하지 않는 이슈 번호(EX-99999) → issue_detail 위젯 드롭', async () => {
    (fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail =
      vi.fn().mockRejectedValue(new Error('404 Not Found'));
    streamSpy.mockImplementation(makeRunnerImpl([
      issueDetail('EX', 99999),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput({ query: 'EX-99999 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.widgets).toBeNull();
  });

  it('존재하는 이슈(EX-1) → issue_detail 위젯 유지', async () => {
    (fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail =
      vi.fn().mockResolvedValue({ issueKey: 'EX-1', title: '기존 이슈' });
    streamSpy.mockImplementation(makeRunnerImpl([
      issueDetail('EX', 1),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput({ query: 'EX-1 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.widgets).toEqual([{ type: 'issue_detail', params: { number: 1, projectKey: 'EX' }, layout: {} }]);
  });

  it('projectKey 없는 issue_detail 위젯은 통과(미검증)', async () => {
    (fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail = vi.fn();
    streamSpy.mockImplementation(makeRunnerImpl([
      toolUse('show_issue_detail', { params: { number: 5 }, layout: {} }),
      result(''),
    ]));
    const out = await runAiChatStream(baseInput({ query: '5번 이슈 보여줘' }), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(out.widgets).toEqual([{ type: 'issue_detail', params: { number: 5 }, layout: {} }]);
    expect((fakeClient as { getIssueDetail: ReturnType<typeof vi.fn> }).getIssueDetail).not.toHaveBeenCalled();
  });
});

// #405: 생성일 필터 쿼리 사전 차단.
describe('runAiChatStream — 생성일 필터 쿼리 사전 차단 (#405)', () => {
  it('이번 주 생성된 이슈 쿼리 → LLM 미호출, 고정 안내 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const out = await runAiChatStream(
      baseInput({ query: '이번 주 생성된 이슈 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toContain('생성 날짜 필터는 지원하지 않습니다');
    expect(out.widgets).toBeNull();
    expect(out.pendingActions).toEqual([]);
    expect((fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential).not.toHaveBeenCalled();
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
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(
      baseInput({ query: '이번 주 이슈 만들어줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect((fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential).toHaveBeenCalled();
  });

  it('마감일 필터 요청("이번 주 마감 이슈") → guard 미적용, LLM 호출됨', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(
      baseInput({ query: '이번 주 마감 이슈 보여줘' }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect((fakeClient as { getProviderCredential: ReturnType<typeof vi.fn> }).getProviderCredential).toHaveBeenCalled();
  });
});

// #406: 복합 요청에서 unassign_self 미처리 시 직접 API 재처리.
describe('runAiChatStream — 복합 요청 unassign 재처리 (#406)', () => {
  it('복합 해제 쿼리 + issue-agent 위임 + onUnassignResult 없음 → unassignSelf 호출', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ])); // onUnassignResult 콜백 없음
    await runAiChatStream(
      baseInput({ query: 'EX-2 이슈 진행중으로 바꾸고 코멘트 남겨줘 그리고 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    expect(unassignSelf).toHaveBeenCalledWith(1, 'EX-2');
  });

  it('복합 해제 쿼리 + onUnassignResult({ok:true}) 있음 → unassignSelf 미호출(이미 처리됨)', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { unassignSuccess: {} })); // onUnassignResult({ok:true})
    await runAiChatStream(
      baseInput({ query: 'EX-2 이슈 진행중으로 바꾸고 코멘트 남겨줘 그리고 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    expect(unassignSelf).not.toHaveBeenCalled();
  });

  it('복합 해제 쿼리 + onUnassignResult({ok:false}) → userId 재처리 시도(unassignSelf 호출)', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    const canonical = '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { unassignError: { canonical } }));
    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈 진행중으로 바꾸고 코멘트 남겨줘 그리고 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    // unassignSelf 성공 → unassign.ok=true 로 갱신 → unassignError override 미발동
    expect(unassignSelf).toHaveBeenCalledWith(1, 'EX-2');
    // userId 재처리 성공이면 canonical override 없이 fallback(위임 답 없음)
    expect(out.fullText).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('단순 해제 쿼리(복합 아님) → unassignSelf 미호출(issue-agent 가 직접 처리)', async () => {
    const unassignSelf = vi.fn().mockResolvedValue(undefined);
    const client406 = { getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 'tok', model: null }), getIssueDetail: vi.fn().mockResolvedValue({ issueKey: 'EX-2' }), unassignSelf } as never;
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ]));
    await runAiChatStream(
      baseInput({ query: 'EX-2 담당자에서 나 해제해줘', userId: 1 }),
      { client: client406 },
      () => {},
      new AbortController().signal,
    );
    expect(unassignSelf).not.toHaveBeenCalled();
  });
});

// #440→#381: 홈 라우터 위임 preamble 누수 가드.
describe('runAiChatStream — 홈 라우터 위임 preamble 누수 가드 (#381, ex-#440)', () => {
  const driveDelegation = agentDelegation('drive-agent');

  it('"위임하겠습니다." preamble delta 는 사용자에게 안 나가고 사이드카 답만 emit', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('위임하겠습니다.'),
      driveDelegation,
      textDelta('"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.'),
      result(''),
    ], { subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' }));
    const got: string[] = [];
    const labels: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, (l) => labels.push(l));
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하겠습니다.');
    expect(streamed).toBe('"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.');
    expect(labels).toContain('드라이브 전문가에게 위임 중');
  });

  it('"드라이브에서 ... 직접 찾아 처리하겠습니다." 변형 preamble 도 안 나간다', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('위임하겠습니다.드라이브에서 파일을 직접 찾아 처리하겠습니다.'),
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하겠습니다.');
    expect(streamed).not.toContain('직접 찾아 처리하겠습니다.');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
  });

  it('"드라이브에서 직접 폴더를 찾아보겠습니다." 추론 preamble 도 안 나간다', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('드라이브에서 "업무문서" 폴더를 찾아 삭제를 진행하겠습니다.드라이브에서 직접 폴더를 찾아보겠습니다.'),
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더 삭제 제안을 등록했습니다. 확인 후 승인하시면 삭제됩니다.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: '"업무문서" 폴더 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('찾아 삭제를 진행하겠습니다.');
    expect(streamed).not.toContain('직접 폴더를 찾아보겠습니다.');
    expect(streamed).toContain('폴더 삭제 제안을 등록했습니다.');
  });

  it('최종 응답 문장은 사이드카 답으로 그대로 보존(오탐 방지)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' }));
    const got: string[] = [];
    const out = await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got.join('')).toContain('삭제를 제안했습니다.');
    expect(out.fullText).toContain('삭제를 제안했습니다.');
  });

  it('회귀: "위임하여 ... 진행합니다." 변형 preamble 도 안 나간다', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('위임하여 파일을 찾고 삭제를 진행합니다.'),
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하여');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
  });

  it('회귀: "찾아 삭제를 제안합니다." 변형 preamble 도 안 나간다', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('드라이브에서 파일을 직접 찾아 삭제를 제안합니다.'),
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('직접 찾아 삭제를 제안합니다.');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
  });

  it('회귀: 청크 분할된 preamble 도 안 나간다(carry 경계 불필요)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('"업무문서" 폴더를 찾았습니다. 삭제를 제안합니'),
      textDelta('다.'),
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더 삭제 제안을 등록했습니다. 확인 후 승인하시면 삭제됩니다.' }));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: '"업무문서" 폴더 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    const streamed = got.join('');
    expect(streamed).not.toContain('찾았습니다. 삭제를 제안합니다.');
    expect(streamed).toContain('폴더 삭제 제안을 등록했습니다.');
  });

  it('drive 쿼리 + 위임 미발생 + streamedText 없음 → fallback 1회(onText)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    const got: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal);
    expect(got).toHaveLength(1);
    expect(got[0]).toBe('요청을 처리하지 못했어요. 다시 시도해 주세요.');
  });

  it('drive 쿼리 + drive-agent 위임 확정 → preamble 미노출 + 사이드카 답 + progress 라벨', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('위임하겠습니다.'),
      driveDelegation,
      result(''),
    ], { subagent: '"업무문서" 폴더의 small.txt 파일 삭제를 제안했습니다. 확인해 주세요.' }));
    const got: string[] = [];
    const labels: string[] = [];
    await runAiChatStream(baseInput({ query: 'small.txt 파일 삭제해줘' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, (l) => labels.push(l));
    const streamed = got.join('');
    expect(streamed).not.toContain('위임하겠습니다.');
    expect(streamed).toContain('small.txt 파일 삭제를 제안했습니다.');
    expect(labels).toContain('드라이브 전문가에게 위임 중');
  });

  it('비드라이브 인사 쿼리 → streamedText(textDelta) 답 반환', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      textDelta('안녕하세요. 무엇을 도와드릴까요?'),
      result(''),
    ]));
    const got: string[] = [];
    const deltas: string[] = [];
    const out = await runAiChatStream(baseInput({ query: '안녕하세요' }), { client: fakeClient }, (t) => got.push(t), new AbortController().signal, undefined, undefined, (t) => deltas.push(t));
    expect(out.fullText).toBe('안녕하세요. 무엇을 도와드릴까요?');
    expect(deltas.join('')).toContain('안녕하세요. 무엇을 도와드릴까요?');
  });
});

// #415: 단순 해제 쿼리 + 위임 시도 + unassign_self 미처리 → 허위 성공 응답 차단.
describe('runAiChatStream — 단순 해제 허위 성공 환각 차단 (#415)', () => {
  it('단순 해제 쿼리 + 위임 + onUnassignResult 없음 → 실패 안내 반환(허위 성공 차단)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result('EX-2 이슈에서 담당이 해제되었습니다.'),
    ])); // onUnassignResult 없음 → unassign === null
    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('담당 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.');
  });

  it('단순 해제 쿼리 + 위임 + onUnassignResult({ok:true}) → subagent 답 통과(실제 해제됨)', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result(''),
    ], { unassignSuccess: {}, subagent: 'EX-2 이슈 담당 해제 완료.' }));
    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    expect(out.fullText).toBe('EX-2 이슈 담당 해제 완료.');
  });

  it('단순 해제 쿼리 + 위임 + onUnassignResult({ok:false}) → unassignError canonical override 통과', async () => {
    const canonical = '담당자 해제 요청을 처리하지 못했습니다. 이슈 화면에서 직접 변경해주세요.';
    streamSpy.mockImplementation(makeRunnerImpl([
      agentDelegation('issue-agent'),
      result('처리 중 오류가 발생했습니다.'),
    ], { unassignError: { canonical } }));
    const out = await runAiChatStream(
      baseInput({ query: 'EX-2 이슈에서 내 담당을 해제해줘', userId: 1 }),
      { client: fakeClient },
      () => {},
      new AbortController().signal,
    );
    // #415 가드 미발동(unassign !== null) → #378 canonical override 발동
    expect(out.fullText).toBe(canonical);
  });
});

// onTool passthrough — mcp.onTool 이 러너 stream 입력에 전달되고, 러너가 이벤트를 발행하면 caller 의 onTool 콜백이 수신하는지 검증.
describe('runAiChatStream — onTool passthrough (#462)', () => {
  it('onTool 콜백을 mcp 설정으로 전달하고 이벤트가 caller 까지 도달한다', async () => {
    streamSpy.mockImplementation((i: RunnerInput, onEvent: (e: RunnerEvent) => void) => {
      // i.mcp.onTool 은 caller 가 넘긴 onTool 참조. 러너가 이 콜백을 호출하면 caller spy 도 함께 기록된다.
      i.mcp?.onTool?.({ seq: 1, event: 'tool_use_start', toolName: 'list_issues', args: {} });
      i.mcp?.onTool?.({ seq: 1, event: 'tool_result', toolName: 'list_issues', isError: false, result: '[]' });
      onEvent(result(''));
      return { done: Promise.resolve(), kill: () => {} };
    });
    const onTool = vi.fn();
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal, undefined, onTool);
    // 동일 참조 확인: mcp.onTool === onTool
    expect(streamSpy.mock.calls[0][0].mcp.onTool).toBe(onTool);
    // 이벤트 흐름 확인: tool_use_start → tool_result 순서로 2건 수신.
    expect(onTool).toHaveBeenCalledTimes(2);
    expect(onTool.mock.calls[0][0]).toMatchObject({ seq: 1, event: 'tool_use_start', toolName: 'list_issues' });
    expect(onTool.mock.calls[1][0]).toMatchObject({ seq: 1, event: 'tool_result', toolName: 'list_issues', isError: false });
  });

  it('onTool 미전달 시 mcp.onTool 은 undefined', async () => {
    streamSpy.mockImplementation(makeRunnerImpl([result('')]));
    await runAiChatStream(baseInput(), { client: fakeClient }, () => {}, new AbortController().signal);
    expect(streamSpy.mock.calls[0][0].mcp.onTool).toBeUndefined();
  });
});

describe('runAiChatStream 로그', () => {
  beforeEach(() => {
    logMock.info.mockClear();
    logMock.warn.mockClear();
    logMock.error.mockClear();
  });

  it('생성일 필터 쿼리는 fallback(reason=created_date_filter_blocked) 을 발행한다', async () => {
    const deps = { client: { getProviderCredential: vi.fn() } } as never;
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
