import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunnerEvent } from './runner-events.js';

// agent-runner mock — runnerFor().stream: onEvent 으로 가짜 RunnerEvent 3개 즉시 주입 후 done resolve.
// (진행 신호: tool_use → 'tool', tool_done → tool_result, result → 종료)
const { streamSpy } = vi.hoisted(() => ({ streamSpy: vi.fn() }));
vi.mock('./agent-runner.js', () => ({
  runnerFor: vi.fn(() => ({ stream: streamSpy, collect: vi.fn() })),
}));
vi.mock('./attachment-prep.js', () => ({ prepareAttachments: vi.fn(async () => []) }));

import { runChatAgent } from './run-chat-agent.js';
import { prepareAttachments } from './attachment-prep.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

// 기본 stream 구현 — search_wiki tool_use → tool_done → result 순으로 발행.
function defaultStreamImpl(_i: unknown, onEvent: (e: RunnerEvent) => void) {
  onEvent({ type: 'tool_use', name: 'mcp__workplace__search_wiki', input: {}, parentToolUseId: null });
  onEvent({ type: 'tool_done' });
  onEvent({ type: 'result', ok: true, text: null, usage: null });
  return { done: Promise.resolve(), kill: vi.fn() };
}

const env: ChatEventEnvelope = {
  type: 'chat.message.posted',
  payload: {
    projectKey: 'WP',
    issueKey: 'WP-1',
    issueId: 1,
    threadId: 5,
    messageId: 9,
    actor: { id: 7, username: 'a', name: 'A', kind: 'HUMAN' },
    body: '@AI',
    mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
    occurredAt: 't',
  },
};

function deps() {
  return {
    client: {
      getProviderCredential: vi.fn(async () => ({ provider: 'anthropic', token: 'TK', model: null })),
      getChatMessages: vi.fn(async () => []),
      listIssueAttachments: vi.fn(async () => []),
      downloadIssueAttachment: vi.fn(),
      postChatProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkplaceApiClient,
  };
}

describe('runChatAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(prepareAttachments).mockResolvedValue([]);
  });

  it('mentions AGENT → 토큰 fetch + 첨부 준비 + SDK spawn(allowFileRead, cwd, mcp, partial=false)', async () => {
    await runChatAgent(env, deps());
    expect(prepareAttachments).toHaveBeenCalled();
    expect(streamSpy).toHaveBeenCalledOnce();
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as {
      allowFileRead?: boolean; cwd?: string; includePartialMessages?: boolean;
      mcp?: { workplaceClient?: unknown; profile?: string; onBehalfOfId?: number };
    };
    expect(runCall.allowFileRead).toBe(true);
    expect(typeof runCall.cwd).toBe('string');
    expect(runCall.includePartialMessages).toBe(false);
    // 러너가 인-프로세스 서버를 chat 프로필 + 멘션된 agentId(99)로 구성하도록 mcp 설정 전달
    expect(runCall.mcp).toMatchObject({ profile: 'chat', onBehalfOfId: 99 });
  });

  it('mentions 에 AGENT 없으면 spawn 생략', async () => {
    const noAgent: ChatEventEnvelope = {
      ...env,
      payload: {
        ...env.payload,
        mentions: [{ id: 7, username: 'a', name: 'A', kind: 'HUMAN' }],
      },
    };
    await runChatAgent(noAgent, deps());
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('모델 결정 이원화 해소: credential.model(redeem 응답)이 env/기본값보다 우선한다', async () => {
    const d = deps();
    vi.mocked(d.client.getProviderCredential).mockResolvedValue({
      provider: 'anthropic',
      token: 'TK',
      model: 'claude-opus-4-1',
    });
    await runChatAgent(env, d);
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
    await runChatAgent(env, d);
    const runCall = vi.mocked(streamSpy).mock.calls[0][0] as { model?: string };
    expect(runCall.model).toBe('claude-sonnet-5');
  });
});

describe('runChatAgent 진행 발행', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamSpy.mockImplementation(defaultStreamImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(prepareAttachments).mockResolvedValue([]);
  });

  it('started → tool → done 순으로 postChatProgress 를 호출한다', async () => {
    const postChatProgress = vi.fn().mockResolvedValue(undefined);
    const testDeps = {
      client: {
        getProviderCredential: vi.fn().mockResolvedValue({ provider: 'anthropic', token: 't', model: null }),
        getChatMessages: vi.fn().mockResolvedValue([]),
        listIssueAttachments: vi.fn().mockResolvedValue([]),
        downloadIssueAttachment: vi.fn(),
        postChatProgress,
      },
    } as never;
    const envelope = {
      type: 'chat.message.posted',
      payload: {
        projectKey: 'P', issueKey: 'P-1', issueId: 1, threadId: 7, messageId: 9,
        actor: { id: 1, username: 'u', name: 'U', kind: 'HUMAN' },
        body: '@AI 도와줘', mentions: [{ id: 9, username: 'ai', name: 'AI', kind: 'AGENT' }],
        occurredAt: '2026-06-18T00:00:00Z',
      },
    } as never;
    await runChatAgent(envelope, testDeps);
    const phases = postChatProgress.mock.calls.map((c: unknown[]) => (c[2] as { phase: string }).phase);
    expect(phases[0]).toBe('started');
    expect(phases).toContain('tool');
    expect(phases[phases.length - 1]).toBe('done');
    // 모든 호출이 동일 streamId
    const ids = new Set(postChatProgress.mock.calls.map((c: unknown[]) => (c[2] as { streamId: string }).streamId));
    expect(ids.size).toBe(1);
  });
});
