import { describe, it, expect, vi, beforeEach } from 'vitest';

// cli-runner 전체 mock — runClaudeCli(기존 테스트 호환) + runClaudeCliStream(신규 테스트) 모두 포함.
// runClaudeCliStream: onLine 으로 가짜 stream-json 3라인 즉시 주입 후 done resolve.
vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['ARGS']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCli: vi.fn(async () => undefined),
  runClaudeCliStream: vi.fn((_i: unknown, onLine: (l: string) => void) => {
    onLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__workplace__get_channel_messages' }] } }));
    onLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }));
    onLine(JSON.stringify({ type: 'result', subtype: 'success' }));
    return { done: Promise.resolve(), kill: vi.fn() };
  }),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));

import { runMessagingAgent } from './run-messaging-agent.js';
import { runClaudeCliStream, buildCliArgs } from './cli-runner.js';
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

  it('respondAsAgentId 로 토큰 fetch + CLI spawn(messaging, allowFileRead=false)', async () => {
    await runMessagingAgent(env, deps());
    expect(runClaudeCliStream).toHaveBeenCalledOnce();
    const argCall = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(argCall.allowFileRead).toBe(false);
  });

  it('토큰 fetch 실패 시 spawn 생략', async () => {
    const d = deps();
    vi.mocked(d.client.getOAuthToken).mockRejectedValueOnce(new Error('no token'));
    await runMessagingAgent(env, d);
    expect(runClaudeCliStream).not.toHaveBeenCalled();
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
    } as any;
    const envelope = {
      type: 'messaging.message.posted',
      payload: {
        channelId: 5, channelKind: 'CHANNEL', messageId: 9, respondAsAgentId: 9,
        actor: { id: 1, name: 'U', kind: 'HUMAN' },
        body: '@AI 도와줘', mentions: [{ id: 9, username: 'ai', name: 'AI', kind: 'AGENT' }],
        occurredAt: '2026-06-18T00:00:00Z',
      },
    } as any;
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
