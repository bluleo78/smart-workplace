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
vi.mock('./attachment-prep.js', () => ({ prepareAttachments: vi.fn(async () => []) }));

import { runChatAgent } from './run-chat-agent.js';
import { runClaudeCli, buildCliArgs } from './cli-runner.js';
import { prepareAttachments } from './attachment-prep.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

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
      getOAuthToken: vi.fn(async () => ({ token: 'TK', label: null })),
      getChatMessages: vi.fn(async () => []),
      listIssueAttachments: vi.fn(async () => []),
      downloadIssueAttachment: vi.fn(),
    } as unknown as WorkplaceApiClient,
  };
}

describe('runChatAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runClaudeCli).mockResolvedValue(undefined);
    vi.mocked(prepareAttachments).mockResolvedValue([]);
  });

  it('mentions AGENT → 토큰 fetch + 첨부 준비 + CLI spawn(allowFileRead, cwd)', async () => {
    await runChatAgent(env, deps());
    expect(prepareAttachments).toHaveBeenCalled();
    expect(runClaudeCli).toHaveBeenCalledOnce();
    const argCall = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(argCall.allowFileRead).toBe(true);
    const runCall = vi.mocked(runClaudeCli).mock.calls[0][0];
    expect(typeof runCall.cwd).toBe('string');
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
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
