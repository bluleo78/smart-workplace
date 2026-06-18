import { describe, it, expect, vi, beforeEach } from 'vitest';

// cli-runner 전체 mock — runClaudeCli(기존 테스트 호환) + runClaudeCliStream(신규 테스트) 모두 포함.
// runClaudeCliStream: onLine 으로 가짜 stream-json 3라인 즉시 주입 후 done resolve.
vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['ARGS']),
  buildChildEnv: vi.fn(() => ({})),
  runClaudeCli: vi.fn(async () => undefined),
  runClaudeCliStream: vi.fn((_i: unknown, onLine: (l: string) => void) => {
    onLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__workplace__search_wiki' }] } }));
    onLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } }));
    onLine(JSON.stringify({ type: 'result', subtype: 'success' }));
    return { done: Promise.resolve(), kill: vi.fn() };
  }),
}));
vi.mock('./mcp-config.js', () => ({
  writeTempMcpConfig: vi.fn(() => '/tmp/cfg.json'),
  cleanupTempMcpConfig: vi.fn(),
}));
vi.mock('./attachment-prep.js', () => ({ prepareAttachments: vi.fn(async () => []) }));

import { runChatAgent } from './run-chat-agent.js';
import { runClaudeCliStream, buildCliArgs } from './cli-runner.js';
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
      postChatProgress: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkplaceApiClient,
  };
}

describe('runChatAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(prepareAttachments).mockResolvedValue([]);
  });

  it('mentions AGENT → 토큰 fetch + 첨부 준비 + CLI spawn(allowFileRead, cwd)', async () => {
    await runChatAgent(env, deps());
    expect(prepareAttachments).toHaveBeenCalled();
    expect(runClaudeCliStream).toHaveBeenCalledOnce();
    const argCall = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(argCall.allowFileRead).toBe(true);
    const runCall = vi.mocked(runClaudeCliStream).mock.calls[0][0];
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
    expect(runClaudeCliStream).not.toHaveBeenCalled();
  });
});

describe('runChatAgent 진행 발행', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(prepareAttachments).mockResolvedValue([]);
  });

  it('started → tool → done 순으로 postChatProgress 를 호출한다', async () => {
    const postChatProgress = vi.fn().mockResolvedValue(undefined);
    const testDeps = {
      client: {
        getOAuthToken: vi.fn().mockResolvedValue({ token: 't', label: 'a' }),
        getChatMessages: vi.fn().mockResolvedValue([]),
        listIssueAttachments: vi.fn().mockResolvedValue([]),
        downloadIssueAttachment: vi.fn(),
        postChatProgress,
      },
    } as any;
    const envelope = {
      type: 'chat.message.posted',
      payload: {
        projectKey: 'P', issueKey: 'P-1', issueId: 1, threadId: 7, messageId: 9,
        actor: { id: 1, username: 'u', name: 'U', kind: 'HUMAN' },
        body: '@AI 도와줘', mentions: [{ id: 9, username: 'ai', name: 'AI', kind: 'AGENT' }],
        occurredAt: '2026-06-18T00:00:00Z',
      },
    } as any;
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
