import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['ARGS']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCli: vi.fn(async () => undefined),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));

import { runMessagingAgent } from './run-messaging-agent.js';
import { runClaudeCli, buildCliArgs } from './cli-runner.js';
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
    } as unknown as WorkplaceApiClient,
  };
}

describe('runMessagingAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runClaudeCli).mockResolvedValue(undefined);
  });

  it('respondAsAgentId 로 토큰 fetch + CLI spawn(messaging, allowFileRead=false)', async () => {
    await runMessagingAgent(env, deps());
    expect(runClaudeCli).toHaveBeenCalledOnce();
    const argCall = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(argCall.allowFileRead).toBe(false);
  });

  it('토큰 fetch 실패 시 spawn 생략', async () => {
    const d = deps();
    vi.mocked(d.client.getOAuthToken).mockRejectedValueOnce(new Error('no token'));
    await runMessagingAgent(env, d);
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
