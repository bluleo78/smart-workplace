import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'fake-msg']),
  buildChildEnv: vi.fn((p, t, a) => ({ ...p, CLAUDE_CODE_OAUTH_TOKEN: t, ACTING_AGENT_ID: String(a) })),
  runClaudeCli: vi.fn().mockResolvedValue(undefined),
}));

import { runAgent } from './run-agent.js';
import { buildCliArgs, buildChildEnv, runClaudeCli } from './cli-runner.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

function client(token: string | Error): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({} as never),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getOAuthToken:
      token instanceof Error
        ? vi.fn().mockRejectedValue(token)
        : vi.fn().mockResolvedValue({ token, label: 'main' }),
    getChatMessages: vi.fn().mockResolvedValue([]),
    addChatMessage: vi.fn().mockResolvedValue(undefined),
    getChannelMessages: vi.fn().mockResolvedValue([]),
    addChannelMessage: vi.fn().mockResolvedValue(undefined),
    listIssueAttachments: vi.fn().mockResolvedValue([]),
    downloadIssueAttachment: vi.fn(),
  };
}

const baseCommon = {
  projectKey: 'WP',
  issueKey: 'WP-1',
  issueId: 1,
  issueTitle: 't',
  actor: { id: 7, username: 'a', kind: 'HUMAN' as const },
  occurredAt: '2026-05-26T00:00:00Z',
};

function envWithAgent(): IssueEventEnvelope {
  return {
    type: 'issue.created',
    payload: {
      ...baseCommon,
      assignees: [{ id: 201, username: 'ai', kind: 'AGENT' }],
      status: 'TODO',
      priority: 'MID',
    },
  };
}

function envHumanOnly(): IssueEventEnvelope {
  return {
    type: 'issue.created',
    payload: {
      ...baseCommon,
      assignees: [{ id: 7, username: 'alice', kind: 'HUMAN' }],
      status: 'TODO',
      priority: 'MID',
    },
  };
}

describe('runAgent', () => {
  beforeEach(() => {
    vi.mocked(buildCliArgs).mockClear();
    vi.mocked(buildChildEnv).mockClear();
    vi.mocked(runClaudeCli).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AGENT assignee 1명 → getOAuthToken(201) + buildChildEnv(_, token, 201)', async () => {
    const c = client('tk-X');
    await runAgent(envWithAgent(), { client: c });
    expect(c.getOAuthToken).toHaveBeenCalledWith(201);
    expect(buildChildEnv).toHaveBeenCalledWith(expect.anything(), 'tk-X', 201);
    expect(runClaudeCli).toHaveBeenCalledOnce();
  });

  it('AGENT 없는 envelope → spawn 생략 + console.warn', async () => {
    const c = client('tk-X');
    await runAgent(envHumanOnly(), { client: c });
    expect(c.getOAuthToken).not.toHaveBeenCalled();
    expect(runClaudeCli).not.toHaveBeenCalled();
  });

  it('token fetch 실패 → spawn 생략', async () => {
    const c = client(new Error('boom'));
    await runAgent(envWithAgent(), { client: c });
    expect(c.getOAuthToken).toHaveBeenCalledOnce();
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
