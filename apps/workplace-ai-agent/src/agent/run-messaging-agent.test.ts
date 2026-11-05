import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunnerEvent } from './runner-events.js';

// agent-runner mock — runnerFor().stream: onEvent 으로 가짜 RunnerEvent 3개 즉시 주입 후 done resolve.
// (진행 신호: tool_use → 'tool', tool_done → tool_result, result → 종료)
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));

import { runMessagingAgent } from './run-messaging-agent.js';
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
