import { describe, it, expect, vi, beforeEach } from 'vitest';

// sdk-runner mock — runSdkStream: onLine 으로 가짜 SDKMessage 3라인 즉시 주입 후 done resolve.
vi.mock('./sdk-runner.js', () => ({
  runSdkStream: vi.fn((_i: unknown, onLine: (l: string) => void) => {
    onLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__workplace__get_channel_messages' }] } }));
    onLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }));
    onLine(JSON.stringify({ type: 'result', subtype: 'success' }));
    return { done: Promise.resolve(), kill: vi.fn() };
  }),
}));
vi.mock('./sdk-mcp-server.js', () => ({
  buildInProcessWorkplaceMcpServer: vi.fn(() => ({ type: 'sdk', name: 'workplace', instance: {} })),
}));

import { runMessagingAgent } from './run-messaging-agent.js';
import { runSdkStream } from './sdk-runner.js';
import { buildInProcessWorkplaceMcpServer } from './sdk-mcp-server.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

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
      getOAuthToken: vi.fn(async () => ({ token: 'TK', label: null })),
      getChannelMessages: vi.fn(async () => []),
      postMessagingProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkplaceApiClient,
  };
}

describe('runMessagingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('respondAsAgentId 로 토큰 fetch + SDK spawn(messaging, allowFileRead=false, partial=false, mcpServers)', async () => {
    await runMessagingAgent(env, deps());
    expect(runSdkStream).toHaveBeenCalledOnce();
    const runCall = vi.mocked(runSdkStream).mock.calls[0][0] as {
      allowFileRead?: boolean; includePartialMessages?: boolean; cwd?: string;
      mcpServers?: Record<string, unknown>;
    };
    expect(runCall.allowFileRead).toBe(false);
    expect(runCall.includePartialMessages).toBe(false);
    expect(runCall.cwd).toBeUndefined(); // messaging 은 첨부 없음 → workDir 없음(SDK 기본 tmpdir)
    expect(runCall.mcpServers?.workplace).toBeDefined();
    // 인-프로세스 서버는 messaging 프로필 + respondAsAgentId(99)로 빌드, delegationContext 포함
    expect(buildInProcessWorkplaceMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: 'messaging',
        onBehalfOfId: 99,
        delegationContext: expect.objectContaining({ actorId: 7, channelId: 42 }),
      }),
    );
  });

  it('토큰 fetch 실패 시 spawn 생략', async () => {
    const d = deps();
    vi.mocked(d.client.getOAuthToken).mockRejectedValueOnce(new Error('no token'));
    await runMessagingAgent(env, d);
    expect(runSdkStream).not.toHaveBeenCalled();
  });
});

describe('runMessagingAgent 진행 발행', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('started → tool → done 순으로 postMessagingProgress 를 호출한다', async () => {
    const postMessagingProgress = vi.fn().mockResolvedValue(undefined);
    const testDeps = {
      client: {
        getOAuthToken: vi.fn().mockResolvedValue({ token: 't', label: 'a' }),
        getChannelMessages: vi.fn().mockResolvedValue([]),
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
