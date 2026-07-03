import { describe, expect, it, vi, beforeEach } from 'vitest';

// @opencode-ai/sdk 를 모킹해 실제 프로세스 스폰 없이 이벤트 매핑만 검증한다.
// vi.mock 은 파일 최상단으로 호이스팅되므로, 그 안에서 참조할 변수는 vi.hoisted 로 선언해야 한다.
const { sessionCreate, sessionAbort, sessionPromptAsync, eventSubscribe, serverClose, createOpencode } = vi.hoisted(() => {
  const sessionCreate = vi.fn();
  const sessionAbort = vi.fn();
  const sessionPromptAsync = vi.fn();
  const eventSubscribe = vi.fn();
  const serverClose = vi.fn();
  const createOpencode = vi.fn(async () => ({
    client: {
      session: { create: sessionCreate, abort: sessionAbort, promptAsync: sessionPromptAsync },
      event: { subscribe: eventSubscribe },
    },
    server: { url: 'http://127.0.0.1:4096', close: serverClose },
  }));
  return { sessionCreate, sessionAbort, sessionPromptAsync, eventSubscribe, serverClose, createOpencode };
});
vi.mock('@opencode-ai/sdk', () => ({ createOpencode }));

vi.mock('./opencode-config.js', () => ({
  buildOpencodeConfig: vi.fn(() => ({})),
  resolveStdioEntryCmd: vi.fn(() => ['npx', 'tsx', 'entry.ts']),
  splitOpencodeModel: vi.fn((model: string) => {
    const idx = model.indexOf('/');
    return { providerID: model.slice(0, idx), modelID: model.slice(idx + 1) };
  }),
}));

// registerBridge/releaseBridge 페어링을 정확히 카운트하기 위해 registry 자체를 모킹.
const { registerBridge, releaseBridge } = vi.hoisted(() => ({
  registerBridge: vi.fn(),
  releaseBridge: vi.fn(),
}));
vi.mock('./bridge-registry.js', () => ({
  registerBridge,
  releaseBridge,
  takeBridge: vi.fn(),
}));

import { OpencodeRunner } from './opencode-runner.js';
import type { RunnerInput } from './agent-runner.js';
import type { RunnerEvent } from './runner-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { HostBridge } from '../mcp/tools.js';

function baseInput(over: Partial<RunnerInput> = {}): RunnerInput {
  return {
    userMessage: 'hi',
    systemPrompt: 'sys',
    model: 'openai/gpt-5',
    maxTurns: 10,
    credential: { provider: 'opencode', payload: { providerId: 'openai', options: {} }, model: null },
    agentId: 3,
    timeoutMs: 5_000,
    logTag: 'test:3',
    ...over,
  };
}

// 제어 가능한 async event 스트림 — push()/finish() 로 테스트가 타이밍을 통제한다.
function makeEventStream() {
  const queue: unknown[] = [];
  let waiter: (() => void) | null = null;
  let finished = false;
  const push = (ev: unknown) => {
    queue.push(ev);
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };
  const finish = () => {
    finished = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w();
    }
  };
  async function* gen() {
    for (;;) {
      while (queue.length) yield queue.shift();
      if (finished) return;
      await new Promise<void>((r) => {
        waiter = r;
      });
    }
  }
  return { push, finish, stream: gen() };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionCreate.mockResolvedValue({ data: { id: 'sess-1' }, error: undefined });
  sessionPromptAsync.mockResolvedValue({ data: undefined, error: undefined });
  sessionAbort.mockResolvedValue({ data: true, error: undefined });
});

describe('OpencodeRunner.stream', () => {
  it('anthropic credential 로 호출하면 즉시 throw', () => {
    const runner = new OpencodeRunner();
    expect(() => runner.stream(baseInput({ credential: { provider: 'anthropic', token: 't', model: null } }), () => {})).toThrow();
  });

  it('텍스트 part 2회 업데이트 → suffix-diff 로 text_delta 2회 합성 후 idle→result', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    // assistant 메시지 선언이 그 메시지의 text part 갱신보다 먼저 와야 델타로 인식된다(user 메시지
    // echo 방지 가드 — opencode-runner.ts 참고).
    es.push({
      type: 'message.updated',
      properties: { info: { id: 'm1', sessionID: 'sess-1', role: 'assistant', tokens: { input: 0, output: 0 } } },
    });
    es.push({ type: 'message.part.updated', properties: { part: { id: 'p1', sessionID: 'sess-1', messageID: 'm1', type: 'text', text: 'Hel' } } });
    es.push({ type: 'message.part.updated', properties: { part: { id: 'p1', sessionID: 'sess-1', messageID: 'm1', type: 'text', text: 'Hello' } } });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    await handle.done;

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel', parentToolUseId: null },
      { type: 'text_delta', text: 'lo', parentToolUseId: null },
      { type: 'result', ok: true, text: 'Hello', usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });

  it('properties.delta 가 있으면 그 값을 그대로 text_delta 로 사용', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({
      type: 'message.updated',
      properties: { info: { id: 'm1', sessionID: 'sess-1', role: 'assistant', tokens: { input: 0, output: 0 } } },
    });
    es.push({
      type: 'message.part.updated',
      properties: { part: { id: 'p1', sessionID: 'sess-1', messageID: 'm1', type: 'text', text: 'Hi!' }, delta: '!!!' },
    });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    await handle.done;

    expect(events[0]).toEqual({ type: 'text_delta', text: '!!!', parentToolUseId: null });
  });

  it('tool part 전이(pending→completed) → tool_use/tool_done + onTool 미러', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({
      type: 'message.part.updated',
      properties: {
        part: { id: 't1', sessionID: 'sess-1', messageID: 'm1', type: 'tool', callID: 'c1', tool: 'mcp__workplace__get_issue', state: { status: 'pending', input: { key: 'ABC-1' }, raw: '' } },
      },
    });
    es.push({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 't1',
          sessionID: 'sess-1',
          messageID: 'm1',
          type: 'tool',
          callID: 'c1',
          tool: 'mcp__workplace__get_issue',
          state: { status: 'completed', input: { key: 'ABC-1' }, output: '{"ok":true}', title: 't', metadata: {}, time: { start: 0, end: 1 } },
        },
      },
    });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const onTool = vi.fn();
    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(
      baseInput({ mcp: { client: {} as unknown as WorkplaceApiClient, profile: 'issue', onBehalfOfId: 1, onTool } }),
      (e) => events.push(e),
    );
    await handle.done;

    expect(events).toEqual([
      { type: 'tool_use', name: 'mcp__workplace__get_issue', input: { key: 'ABC-1' }, parentToolUseId: null },
      { type: 'tool_done' },
      { type: 'result', ok: true, text: '', usage: null },
    ]);
    expect(onTool).toHaveBeenNthCalledWith(1, { seq: 1, event: 'tool_use_start', toolName: 'mcp__workplace__get_issue', args: { key: 'ABC-1' } });
    expect(onTool).toHaveBeenNthCalledWith(2, {
      seq: 1,
      event: 'tool_result',
      toolName: 'mcp__workplace__get_issue',
      isError: false,
      result: '{"ok":true}',
    });
  });

  it('도구 2개가 인터리브(A시작→B시작→A완료→B완료)돼도 각 result 의 seq 가 자신의 start 와 일치 — 프론트 useChatSession.ts 의 seq 매칭(running→done)이 순서와 무관하게 성립함을 보증', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    const toolPart = (id: string, status: 'pending' | 'completed', extra: Record<string, unknown> = {}) => ({
      type: 'message.part.updated',
      properties: {
        part: {
          id,
          sessionID: 'sess-1',
          messageID: 'm1',
          type: 'tool',
          callID: id,
          tool: 'mcp__workplace__get_issue',
          state:
            status === 'pending'
              ? { status: 'pending', input: { key: id }, raw: '' }
              : { status: 'completed', input: { key: id }, output: `{"id":"${id}"}`, title: 't', metadata: {}, time: { start: 0, end: 1 }, ...extra },
        },
      },
    });
    es.push(toolPart('a', 'pending'));
    es.push(toolPart('b', 'pending'));
    es.push(toolPart('a', 'completed'));
    es.push(toolPart('b', 'completed'));
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const onTool = vi.fn();
    const runner = new OpencodeRunner();
    const handle = runner.stream(
      baseInput({ mcp: { client: {} as unknown as WorkplaceApiClient, profile: 'issue', onBehalfOfId: 1, onTool } }),
      () => {},
    );
    await handle.done;

    const calls = onTool.mock.calls.map((c) => c[0]);
    const startA = calls.find((c) => c.event === 'tool_use_start' && c.args?.key === 'a');
    const resultA = calls.find((c) => c.event === 'tool_result' && c.result === '{"id":"a"}');
    const startB = calls.find((c) => c.event === 'tool_use_start' && c.args?.key === 'b');
    const resultB = calls.find((c) => c.event === 'tool_result' && c.result === '{"id":"b"}');
    expect(resultA.seq).toBe(startA.seq);
    expect(resultB.seq).toBe(startB.seq);
    expect(startA.seq).not.toBe(startB.seq);
  });

  it('session.updated 로 parentID 일치하는 자식 세션이 알려지면 그 세션의 tool part 가 드롭되지 않고 parentToolUseId 에 자식 세션 id 가 실림', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    // primary(sess-1) 가 서브에이전트에 위임 → opencode 가 parentID: 'sess-1' 인 자식 세션(sess-2) 생성.
    es.push({ type: 'session.updated', properties: { info: { id: 'sess-2', parentID: 'sess-1' } } });
    es.push({
      type: 'message.part.updated',
      properties: {
        part: { id: 'ct1', sessionID: 'sess-2', messageID: 'm2', type: 'tool', callID: 'c2', tool: 'mcp__workplace__list_issues', state: { status: 'pending', input: {}, raw: '' } },
      },
    });
    es.push({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'ct1',
          sessionID: 'sess-2',
          messageID: 'm2',
          type: 'tool',
          callID: 'c2',
          tool: 'mcp__workplace__list_issues',
          state: { status: 'completed', input: {}, output: '{"ok":true}', title: 't', metadata: {}, time: { start: 0, end: 1 } },
        },
      },
    });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    await handle.done;

    expect(events).toEqual([
      { type: 'tool_use', name: 'mcp__workplace__list_issues', input: {}, parentToolUseId: 'sess-2' },
      { type: 'tool_done' },
      { type: 'result', ok: true, text: '', usage: null },
    ]);
  });

  it('parentID 가 primary 와 다른 세션은 알려진 세션에 편입되지 않아 그 세션의 part 는 계속 드롭됨', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    // 무관한 세션(parentID 없음/불일치) — 알려진 세션 집합에 들어가지 않아야 함.
    es.push({ type: 'session.updated', properties: { info: { id: 'sess-99', parentID: 'other-root' } } });
    es.push({
      type: 'message.part.updated',
      properties: { part: { id: 'p9', sessionID: 'sess-99', messageID: 'm9', type: 'text', text: 'nope' } },
    });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    await handle.done;

    expect(events).toEqual([{ type: 'result', ok: true, text: '', usage: null }]);
  });

  it('primary 세션 part 는 여전히 parentToolUseId: null', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({
      type: 'message.part.updated',
      properties: {
        part: { id: 't1', sessionID: 'sess-1', messageID: 'm1', type: 'tool', callID: 'c1', tool: 'mcp__workplace__get_issue', state: { status: 'pending', input: { key: 'ABC-1' }, raw: '' } },
      },
    });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    await handle.done;

    expect(events[0]).toEqual({ type: 'tool_use', name: 'mcp__workplace__get_issue', input: { key: 'ABC-1' }, parentToolUseId: null });
  });

  it('session.error → done 이 reject', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.error', properties: { sessionID: 'sess-1', error: { name: 'UnknownError', data: { message: 'boom' } } } });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    await expect(handle.done).rejects.toThrow();
    expect(events).toEqual([{ type: 'result', ok: false, text: null, usage: null }]);
  });

  it('kill() 은 abort 요청 후 정상 resolve', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    // abort 호출 시 스트림 종료(실제 opencode 가 세션 종료로 스트림을 끊는 상황을 근사)
    sessionAbort.mockImplementation(async () => {
      es.finish();
      return { data: true, error: undefined };
    });

    const runner = new OpencodeRunner();
    const events: RunnerEvent[] = [];
    const handle = runner.stream(baseInput(), (e) => events.push(e));
    // session.create/event.subscribe 가 끝나 client/sessionId 준비될 때까지 대기 후 kill
    // (그 전에 kill 하면 abort 대상 client 가 아직 없어 요청 자체가 no-op 이 됨).
    await vi.waitFor(() => expect(eventSubscribe).toHaveBeenCalled());
    handle.kill();
    await expect(handle.done).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it('promptAsync 를 splitOpencodeModel 결과 + agent:primary + userMessage 로 호출', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const handle = runner.stream(baseInput({ userMessage: '안녕' }), () => {});
    await handle.done;

    expect(sessionPromptAsync).toHaveBeenCalledWith({
      path: { id: 'sess-1' },
      body: {
        agent: 'primary',
        model: { providerID: 'openai', modelID: 'gpt-5' },
        parts: [{ type: 'text', text: '안녕' }],
      },
    });
  });
});

describe('OpencodeRunner.collect', () => {
  it('stream 을 내부 소비해 RunnerEvent[] 반환', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const events = await runner.collect(baseInput());
    expect(events).toEqual([{ type: 'result', ok: true, text: '', usage: null }]);
  });
});

describe('registerBridge/releaseBridge 페어링', () => {
  it('hostBridge 있으면 성공 경로에서 register/release 각 정확히 1회, 같은 runId', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });
    const bridge: HostBridge = { onProposal: vi.fn(), onSubmitResponse: vi.fn(), onUnassignResult: vi.fn() };

    const runner = new OpencodeRunner();
    const handle = runner.stream(
      baseInput({ mcp: { client: {} as unknown as WorkplaceApiClient, profile: 'messaging', onBehalfOfId: 1, hostBridge: bridge } }),
      () => {},
    );
    await handle.done;

    expect(registerBridge).toHaveBeenCalledOnce();
    expect(releaseBridge).toHaveBeenCalledOnce();
    const runId = registerBridge.mock.calls[0][0];
    expect(releaseBridge.mock.calls[0][0]).toBe(runId);
    expect(registerBridge.mock.calls[0][1]).toBe(bridge);
  });

  it('session.error 경로에서도 register/release 페어링 유지', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.error', properties: { sessionID: 'sess-1' } });
    const bridge: HostBridge = { onProposal: vi.fn(), onSubmitResponse: vi.fn(), onUnassignResult: vi.fn() };

    const runner = new OpencodeRunner();
    const handle = runner.stream(
      baseInput({ mcp: { client: {} as unknown as WorkplaceApiClient, profile: 'messaging', onBehalfOfId: 1, hostBridge: bridge } }),
      () => {},
    );
    await expect(handle.done).rejects.toThrow();

    expect(registerBridge).toHaveBeenCalledOnce();
    expect(releaseBridge).toHaveBeenCalledOnce();
  });

  it('kill() 경로에서도 register/release 페어링 유지', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    sessionAbort.mockImplementation(async () => {
      es.finish();
      return { data: true, error: undefined };
    });
    const bridge: HostBridge = { onProposal: vi.fn(), onSubmitResponse: vi.fn(), onUnassignResult: vi.fn() };

    const runner = new OpencodeRunner();
    const handle = runner.stream(
      baseInput({ mcp: { client: {} as unknown as WorkplaceApiClient, profile: 'messaging', onBehalfOfId: 1, hostBridge: bridge } }),
      () => {},
    );
    await vi.waitFor(() => expect(eventSubscribe).toHaveBeenCalled());
    handle.kill();
    await handle.done;

    expect(registerBridge).toHaveBeenCalledOnce();
    expect(releaseBridge).toHaveBeenCalledOnce();
  });

  it('hostBridge 없으면 register/release 둘 다 호출 안 함', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const handle = runner.stream(baseInput(), () => {});
    await handle.done;

    expect(registerBridge).not.toHaveBeenCalled();
    expect(releaseBridge).not.toHaveBeenCalled();
  });
});

describe('opencode 서버 정리', () => {
  it('idle 성공 경로에서도 server.close() 로 자식 프로세스를 정리', async () => {
    const es = makeEventStream();
    eventSubscribe.mockResolvedValue({ stream: es.stream });
    es.push({ type: 'session.idle', properties: { sessionID: 'sess-1' } });

    const runner = new OpencodeRunner();
    const handle = runner.stream(baseInput(), () => {});
    await handle.done;

    expect(serverClose).toHaveBeenCalledOnce();
  });
});
