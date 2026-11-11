import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunnerEvent } from './runner-events.js';

// agent-runner mock — runnerFor().stream: onEvent 으로 가짜 RunnerEvent 3개 즉시 주입 후 done resolve.
// (진행 신호: tool_use → 'tool', tool_done → tool_result, result → 종료)
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));

// WP-1489: 실행 기록 로그(messaging_run_trace) 검증 — 파일 로거를 가짜로 바꾼다.
vi.mock('../logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { REPLY_IN_FLIGHT_WAIT_MS, runMessagingAgent } from './run-messaging-agent.js';
import { log } from '../logger.js';
import { MESSAGING_SYSTEM_PROMPT } from './messaging-system-prompt.js';
import { AGENT_INSTRUCTIONS_HEADER } from './agent-instructions.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

// 기본 stream 구현 — list_channel_messages tool_use → tool_done → result 순으로 발행.
function defaultStreamImpl(_i: unknown, onEvent: (e: RunnerEvent) => void) {
  onEvent({ type: 'tool_use', name: 'mcp__workplace__list_channel_messages', input: {}, parentToolUseId: null });
  onEvent({ type: 'tool_done' });
  onEvent({ type: 'result', ok: true, text: null, usage: null });
  return { done: Promise.resolve(), kill: vi.fn() };
}

const env: MessagingEventEnvelope = {
  type: 'messaging.message.posted',
  payload: {
    channelId: 42,
    channelKind: 'CHANNEL',
    messageId: 9,
    respondAsAgentId: 99,
    actor: { id: 7, name: 'A', kind: 'HUMAN' },
    body: '@AI',
    mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
    occurredAt: 't',
  },
};

function deps() {
  return {
    client: {
      getProviderCredential: vi.fn(async () => ({ provider: 'anthropic', token: 'TK', model: null })),
      // #846: 최근 메시지 프리페치는 공유 도구용 클라이언트(toolClient) 경유. WP-1368: 지시 조회(getMember)도 — 기본은 지시 없음.
      toolClient: () => ({
        listChannelMessages: vi.fn(async () => ({ items: [] })),
        getMember: vi.fn(async () => ({ userId: 99, instructions: null })),
      }),
      postMessagingProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkplaceApiClient,
  };
}

describe('runMessagingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('respondAsAgentId 로 토큰 fetch + SDK spawn(messaging, allowFileRead=false, partial=false, mcp)', async () => {
    await runMessagingAgent(env, deps());
    expect(streamSpy).toHaveBeenCalledOnce();
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as {
      allowFileRead?: boolean; includePartialMessages?: boolean; cwd?: string;
      mcp?: { profile?: string; onBehalfOfId?: number; delegationContext?: { actorId?: number; channelId?: number } };
    };
    expect(runCall.allowFileRead).toBe(false);
    expect(runCall.includePartialMessages).toBe(false);
    expect(runCall.cwd).toBeUndefined(); // messaging 은 첨부 없음 → workDir 없음(SDK 기본 tmpdir)
    // 러너가 인-프로세스 서버를 messaging 프로필 + respondAsAgentId(99)로 구성하도록 mcp 설정 전달, delegationContext 포함
    expect(runCall.mcp).toMatchObject({
      profile: 'messaging',
      onBehalfOfId: 99,
      delegationContext: expect.objectContaining({ actorId: 7, channelId: 42 }),
    });
  });

  it('WP-352: 최근 메시지 프리페치는 listChannelMessages(channelId, {limit}) 의 items 로 대화 흐름을 만든다', async () => {
    const listChannelMessages = vi.fn(async () => ({
      items: [{ id: 1, authorName: '홍길동', authorKind: 'HUMAN', body: '이전 대화 본문', deleted: false }],
      nextCursor: 'older==',
      hasMore: true,
    }));
    const d = deps();
    (d.client as unknown as { toolClient: () => unknown }).toolClient = () => ({ listChannelMessages });
    await runMessagingAgent(env, d);
    expect(listChannelMessages).toHaveBeenCalledWith(42, { limit: 20 });
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as { prompt?: string; userMessage?: string };
    expect(JSON.stringify(runCall)).toContain('이전 대화 본문');
  });

  // WP-1368: 이 AI 의 지시는 답하는 AI 자신을 조회해 시스템 프롬프트 맨 뒤에 붙인다 — 없으면 기존 프롬프트 그대로.
  it('지시가 있으면 systemPrompt 끝에 지시 블록, 없으면 기존 상수 그대로', async () => {
    const d = deps();
    const getMember = vi.fn(async () => ({ userId: 99, instructions: '존댓말로 답한다' }));
    const toolClient = vi.fn(() => ({ listChannelMessages: vi.fn(async () => ({ items: [] })), getMember }));
    (d.client as unknown as { toolClient: unknown }).toolClient = toolClient;
    await runMessagingAgent(env, d);
    expect(toolClient).toHaveBeenCalledWith(99);
    expect(getMember).toHaveBeenCalledWith(99);
    const withInstr = (vi.mocked(streamSpy).mock.calls[0][0] as { systemPrompt: string }).systemPrompt;
    expect(withInstr.startsWith(MESSAGING_SYSTEM_PROMPT)).toBe(true);
    expect(withInstr).toContain(AGENT_INSTRUCTIONS_HEADER);
    expect(withInstr.endsWith('\n\n존댓말로 답한다')).toBe(true);

    await runMessagingAgent(env, deps());
    expect((vi.mocked(streamSpy).mock.calls[1][0] as { systemPrompt: string }).systemPrompt).toBe(MESSAGING_SYSTEM_PROMPT);
  });

  it('지시 조회가 실패해도 지시 없이 실행한다', async () => {
    const d = deps();
    (d.client as unknown as { toolClient: unknown }).toolClient = () => ({
      listChannelMessages: vi.fn(async () => ({ items: [] })),
      getMember: vi.fn().mockRejectedValue(new Error('500')),
    });
    await runMessagingAgent(env, d);
    expect(streamSpy).toHaveBeenCalledOnce();
    expect((vi.mocked(streamSpy).mock.calls[0][0] as { systemPrompt: string }).systemPrompt).toBe(MESSAGING_SYSTEM_PROMPT);
  });

  it('토큰 fetch 실패 시 spawn 생략', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockRejectedValueOnce(new Error('no token'));
    await runMessagingAgent(env, d);
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('모델 결정 이원화 해소: credential.model(redeem 응답)이 env/기본값보다 우선한다', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'TK',
      model: 'claude-opus-4-1',
    });
    await runMessagingAgent(env, d);
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as { model?: string };
    expect(runCall.model).toBe('claude-opus-4-1');
  });

  it('credential.model 이 null 이면 env/기본값으로 폴백한다', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'TK',
      model: null,
    });
    await runMessagingAgent(env, d);
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as { model?: string };
    expect(runCall.model).toBe('claude-sonnet-5-5');
  });
});

describe('runMessagingAgent 진행 발행', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('started → tool → done 순으로 postMessagingProgress 를 호출한다', async () => {
    const postMessagingProgress = vi.fn().mockResolvedValue(undefined);
    const testDeps = {
      client: {
        getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 't', model: null }),
        toolClient: () => ({ listChannelMessages: vi.fn().mockResolvedValue({ items: [] }) }),
        postMessagingProgress,
      },
    } as never;
    const envelope = {
      type: 'messaging.message.posted',
      payload: {
        channelId: 5, channelKind: 'CHANNEL', messageId: 9, respondAsAgentId: 9,
        actor: { id: 1, name: 'U', kind: 'HUMAN' },
        body: '@AI 도와줘', mentions: [{ id: 9, username: 'ai', name: 'AI', kind: 'AGENT' }],
        occurredAt: '2026-06-18T00:00:00Z',
      },
    } as never;
    await runMessagingAgent(envelope, testDeps);
    const phases = postMessagingProgress.mock.calls.map((c: unknown[]) => (c[2] as { phase: string }).phase);
    expect(phases[0]).toBe('started');
    expect(phases).toContain('tool');
    expect(phases[phases.length - 1]).toBe('done');
    // 모든 호출이 동일 streamId
    const ids = new Set(postMessagingProgress.mock.calls.map((c: unknown[]) => (c[2] as { streamId: string }).streamId));
    expect(ids.size).toBe(1);
    // channelId=5 가 2번째 인자
    expect(postMessagingProgress.mock.calls[0][1]).toBe(5);
  });
});

// WP-1489: 답장 도구(add_channel_message·propose_create_issue·propose_create_event)가 하나도 성공하지 못한 채 실행이 끝나면
// 그 AI 이름으로 같은 채널(스레드)에 대신 답한다 — 모델의 마지막 텍스트가 있으면 그것, 없거나 오류로 끝났으면 안내 문구.
// 그리고 실행마다 messaging_run_trace 로그 한 줄(본문 없음)을 남긴다.
describe('runMessagingAgent 답장 없이 끝날 때 대신 답하기 (WP-1489)', () => {
  const NOTICE = '요청을 처리하지 못했습니다. 다시 말씀해 주세요.';
  type OnTool = (line: {
    seq: number; event: 'tool_use_start' | 'tool_result'; toolName: string; args?: Record<string, unknown>; isError?: boolean; result?: string;
  }) => void;
  type StreamInput = { mcp?: { onTool?: OnTool } };

  // toolClient 는 호출마다 같은 객체를 돌려줘야 addChannelMessage 호출을 검증할 수 있다.
  function fallbackDeps() {
    const addChannelMessage = vi.fn().mockResolvedValue(undefined);
    const tc = {
      listChannelMessages: vi.fn(async () => ({ items: [] })),
      getMember: vi.fn(async () => ({ userId: 99, instructions: null })),
      searchMembers: vi.fn(async () => ({ items: [] })),
      addChannelMessage,
    };
    const d = {
      client: {
        getProviderCredential: vi.fn(async () => ({ provider: 'anthropic', token: 'TK', model: null })),
        toolClient: vi.fn(() => tc),
        postMessagingProgress: vi.fn().mockResolvedValue(undefined),
      } as unknown as WorkplaceApiClient,
    };
    return { d, addChannelMessage };
  }

  // 러너 흉내 — 이벤트 열을 내고, 도구 결과 줄은 mcp.onTool 로 알린다(두 러너 모두 이 콜백으로 도구 결과를 알린다).
  // 시작 줄의 인자는 기본으로 트리거 채널(42) — 두 러너 모두 시작 줄에 인자를 싣는다.
  function streamWith(
    events: RunnerEvent[],
    toolResults: { toolName: string; isError: boolean; result: string; args?: Record<string, unknown> }[] = [],
    opts: { reject?: boolean } = {},
  ) {
    return (i: StreamInput, onEvent: (e: RunnerEvent) => void) => {
      toolResults.forEach((t, n) => {
        i.mcp?.onTool?.({ seq: n + 1, event: 'tool_use_start', toolName: t.toolName, args: t.args ?? { channelId: 42, body: 'x' } });
        i.mcp?.onTool?.({ seq: n + 1, event: 'tool_result', toolName: t.toolName, isError: t.isError, result: t.result });
      });
      events.forEach(onEvent);
      return { done: opts.reject ? Promise.reject(new Error('boom')) : Promise.resolve(), kill: vi.fn() };
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('답장 도구 없이 텍스트로 끝나면 그 텍스트를 같은 채널에 올린다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith([
        { type: 'assistant_text', text: '이슈 필드는 제가 바꿀 수 없습니다.' },
        { type: 'result', ok: true, text: '이슈 필드는 제가 바꿀 수 없습니다.', usage: null },
      ]),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][0]).toBe(42);
    expect(addChannelMessage.mock.calls[0][1]).toBe('이슈 필드는 제가 바꿀 수 없습니다.');
    expect(addChannelMessage.mock.calls[0][2]).toBeUndefined();
    // 같은 AI 신원(respondAsAgentId)의 도구 클라이언트로 올린다
    expect(d.client.toolClient).toHaveBeenCalledWith(99);
  });

  it('답장 도구도 텍스트도 없이 끝나면 안내 문구를 올린다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith(
        [
          { type: 'tool_use', name: 'mcp__workplace__list_channel_messages', input: {}, parentToolUseId: null },
          { type: 'tool_done' },
          { type: 'result', ok: true, text: null, usage: null },
        ],
        [{ toolName: 'list_channel_messages', isError: false, result: '{"items":[]}' }],
      ),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][1]).toBe(NOTICE);
  });

  it('오류로 끝나면(텍스트가 있어도) 안내 문구를 올린다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith(
        [
          { type: 'assistant_text', text: 'API Error: 529 overloaded' },
          { type: 'result', ok: false, text: 'API Error: 529 overloaded', usage: null },
        ],
        [],
        { reject: true },
      ),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][1]).toBe(NOTICE);
  });

  it('result 가 ok:false 로 끝나도(최대 턴 등) 오류로 보고 안내 문구를 올린다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: false, text: null, usage: null }]));
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][1]).toBe(NOTICE);
  });

  it('스레드 실행이면 그 스레드(parent)로 올린다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: null, usage: null }]));
    const threadEnv: MessagingEventEnvelope = { ...env, payload: { ...env.payload, triggerParentMessageId: 555 } };
    await runMessagingAgent(threadEnv, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][0]).toBe(42);
    expect(addChannelMessage.mock.calls[0][2]).toBe(555);
  });

  it('add_channel_message 가 성공했으면 더 올리지 않는다(opencode 접두 이름도)', async () => {
    for (const toolName of ['add_channel_message', 'workplace_add_channel_message']) {
      const { d, addChannelMessage } = fallbackDeps();
      streamSpy.mockImplementation(
        streamWith(
          [
            { type: 'assistant_text', text: '답했습니다' },
            { type: 'result', ok: true, text: '답했습니다', usage: null },
          ],
          [{ toolName, isError: false, result: 'ok' }],
        ),
      );
      await runMessagingAgent(env, d);
      expect(addChannelMessage).not.toHaveBeenCalled();
    }
  });

  it('답장 도구가 성공한 뒤 오류로 끝나도 더 올리지 않는다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith([{ type: 'result', ok: false, text: null, usage: null }], [
        { toolName: 'propose_create_issue', isError: false, result: '제안 카드를 올렸습니다. 위임자의 승인을 기다립니다.' },
      ]),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).not.toHaveBeenCalled();
  });

  it('add_channel_message 가 실패(isError)했으면 대신 답한다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith([{ type: 'result', ok: true, text: null, usage: null }], [
        { toolName: 'add_channel_message', isError: true, result: 'HTTP 500' },
      ]),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][1]).toBe(NOTICE);
  });

  it('propose_* 가 실패 문구를 돌려줬으면(isError 아님) 대신 답한다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith([{ type: 'result', ok: true, text: null, usage: null }], [
        { toolName: 'propose_create_event', isError: false, result: '일정 제안 등록에 실패했습니다: 400' },
      ]),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
  });

  it('대신 답하기가 실패해도 throw 하지 않고 done 을 발행한다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    addChannelMessage.mockRejectedValueOnce(new Error('HTTP 503'));
    streamSpy.mockImplementation(streamWith([{ type: 'result', ok: true, text: null, usage: null }]));
    await expect(runMessagingAgent(env, d)).resolves.toBeUndefined();
    const phases = vi.mocked(d.client.postMessagingProgress).mock.calls.map((c) => (c[2] as { phase: string }).phase);
    expect(phases[phases.length - 1]).toBe('done');
  });

  it('실행마다 messaging_run_trace 로그 한 줄 — 필드는 숫자·이름뿐, 본문 없음', async () => {
    const { d } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith(
        [
          { type: 'tool_use', name: 'mcp__workplace__list_channel_messages', input: {}, parentToolUseId: null },
          { type: 'tool_done' },
          { type: 'assistant_text', text: '비밀 본문' },
          { type: 'result', ok: true, text: '비밀 본문', usage: null },
        ],
        [{ toolName: 'list_channel_messages', isError: false, result: '{"items":[]}' }],
      ),
    );
    await runMessagingAgent(env, d);
    const calls = [...vi.mocked(log.info).mock.calls, ...vi.mocked(log.warn).mock.calls].filter(
      (c) => c[1] === 'messaging_run_trace',
    );
    expect(calls).toHaveLength(1);
    const [tag, , fields] = calls[0];
    expect(tag).toBe('run-messaging-agent');
    expect(fields).toMatchObject({
      channelId: 42,
      agentId: 99,
      model: 'claude-sonnet-5-5',
      outcome: 'ok',
      toolCalls: 1,
      tools: { list_channel_messages: 1 },
      replied: false,
      fallbackUsed: true,
    });
    expect(typeof (fields as { durationMs: unknown }).durationMs).toBe('number');
    expect(JSON.stringify(fields)).not.toContain('비밀 본문');
  });

  it('답장한 실행의 로그는 replied:true · fallbackUsed:false', async () => {
    const { d } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith([{ type: 'result', ok: true, text: null, usage: null }], [
        { toolName: 'add_channel_message', isError: false, result: 'ok' },
      ]),
    );
    await runMessagingAgent(env, d);
    const ok = vi.mocked(log.info).mock.calls.find((c) => c[1] === 'messaging_run_trace');
    expect(ok?.[2]).toMatchObject({ outcome: 'ok', replied: true, fallbackUsed: false });
  });

  it('오류로 끝난 실행의 로그는 outcome:error · fallbackUsed:true', async () => {
    const { d } = fallbackDeps();
    streamSpy.mockImplementation(streamWith([], [], { reject: true }));
    await runMessagingAgent(env, d);
    const err = vi.mocked(log.warn).mock.calls.find((c) => c[1] === 'messaging_run_trace');
    expect(err?.[2]).toMatchObject({ outcome: 'error', replied: false, fallbackUsed: true });
  });
  // 코드 리뷰 반영(WP-1489) ---------------------------------------------------------------

  it('도구 호출 뒤 텍스트 없이 끝나면 앞의 진행 서술이 아니라 안내 문구를 올린다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith(
        [
          { type: 'assistant_text', text: '먼저 채널 메시지를 조회해 볼게요.' },
          { type: 'tool_use', name: 'mcp__workplace__list_channel_messages', input: {}, parentToolUseId: null },
          { type: 'tool_done' },
          { type: 'result', ok: true, text: '먼저 채널 메시지를 조회해 볼게요.', usage: null },
        ],
        [{ toolName: 'list_channel_messages', isError: false, result: '{"items":[]}' }],
      ),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][1]).toBe(NOTICE);
  });

  it('다른 채널에 쓴 add_channel_message 는 답장이 아니다 — 트리거 채널에 대신 답한다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation(
      streamWith([{ type: 'result', ok: true, text: null, usage: null }], [
        { toolName: 'add_channel_message', isError: false, result: 'ok', args: { channelId: 77, body: '다른 채널' } },
      ]),
    );
    await runMessagingAgent(env, d);
    expect(addChannelMessage).toHaveBeenCalledOnce();
    expect(addChannelMessage.mock.calls[0][0]).toBe(42);
  });

  it('감싸이거나 공백이 붙은 결과(opencode output)도 ok 로 읽어 중복으로 올리지 않는다', async () => {
    for (const result of ['  ok\n', '"ok"', '[{"type":"text","text":"ok"}]', '{"content":[{"type":"text","text":" ok "}]}']) {
      const { d, addChannelMessage } = fallbackDeps();
      streamSpy.mockImplementation(
        streamWith([{ type: 'result', ok: true, text: null, usage: null }], [
          { toolName: 'workplace_add_channel_message', isError: false, result },
        ]),
      );
      await runMessagingAgent(env, d);
      expect(addChannelMessage).not.toHaveBeenCalled();
    }
  });

  it('러너가 끝난 뒤 늦게 온 답장 결과를 기다려 반영한다 — 대신 답하지 않는다', async () => {
    const { d, addChannelMessage } = fallbackDeps();
    streamSpy.mockImplementation((i: StreamInput, onEvent: (e: RunnerEvent) => void) => {
      i.mcp?.onTool?.({ seq: 1, event: 'tool_use_start', toolName: 'add_channel_message', args: { channelId: 42, body: '답' } });
      onEvent({ type: 'result', ok: false, text: null, usage: null });
      // 결과 줄이 러너 종료 뒤에 도착한다(시간 초과 직후·opencode completed part 지연)
      setTimeout(() => i.mcp?.onTool?.({ seq: 1, event: 'tool_result', toolName: 'add_channel_message', isError: false, result: 'ok' }), 20);
      return { done: Promise.resolve(), kill: vi.fn() };
    });
    await runMessagingAgent(env, d);
    expect(addChannelMessage).not.toHaveBeenCalled();
    const line = vi.mocked(log.warn).mock.calls.find((c) => c[1] === 'messaging_run_trace');
    expect(line?.[2]).toMatchObject({ replied: true, fallbackUsed: false, fallbackSkipped: null });
  });

  it('기다려도 답장 결과를 모르면 대신 답하지 않고 fallbackSkipped: reply_in_flight 로 남긴다', async () => {
    vi.useFakeTimers();
    try {
      const { d, addChannelMessage } = fallbackDeps();
      streamSpy.mockImplementation((i: StreamInput, onEvent: (e: RunnerEvent) => void) => {
        i.mcp?.onTool?.({ seq: 1, event: 'tool_use_start', toolName: 'add_channel_message', args: { channelId: 42, body: '답' } });
        onEvent({ type: 'result', ok: false, text: null, usage: null });
        return { done: Promise.resolve(), kill: vi.fn() };
      });
      const run = runMessagingAgent(env, d);
      await vi.advanceTimersByTimeAsync(REPLY_IN_FLIGHT_WAIT_MS + 10);
      await run;
      expect(addChannelMessage).not.toHaveBeenCalled();
      const line = vi.mocked(log.warn).mock.calls.find((c) => c[1] === 'messaging_run_trace');
      expect(line?.[2]).toMatchObject({ replied: false, fallbackUsed: false, fallbackSkipped: 'reply_in_flight' });
    } finally {
      vi.useRealTimers();
    }
  });
});
