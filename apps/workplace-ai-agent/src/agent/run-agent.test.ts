import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'fake-msg']),
  buildChildEnv: vi.fn((p, t) => ({ ...p, CLAUDE_CODE_OAUTH_TOKEN: t })),
  runClaudeCli: vi.fn().mockResolvedValue(undefined),
}));

import { runAgent } from './run-agent.js';
import { buildCliArgs, buildChildEnv, runClaudeCli } from './cli-runner.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

function client(token: string | Error): WorkplaceApiClient {
  return {
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updateIssueStatus: vi.fn().mockResolvedValue(undefined),
    getIssueDetail: vi.fn().mockResolvedValue({} as never),
    unassignSelf: vi.fn().mockResolvedValue(undefined),
    getCachedSelfUserId: vi.fn().mockResolvedValue(201),
    getMyOAuthToken:
      token instanceof Error
        ? vi.fn().mockRejectedValue(token)
        : vi.fn().mockResolvedValue({ token, label: 'main' }),
  };
}

const env = {
  type: 'issue.created' as const,
  payload: {
    projectKey: 'WP',
    issueKey: 'WP-1',
    issueId: 1,
    issueTitle: 't',
    actor: { id: 7, username: 'a', kind: 'HUMAN' as const },
    assignees: [],
    occurredAt: '2026-05-26T00:00:00Z',
    status: 'TODO',
    priority: 'MID',
  },
};

describe('runAgent', () => {
  beforeEach(() => {
    vi.mocked(buildCliArgs).mockClear();
    vi.mocked(buildChildEnv).mockClear();
    vi.mocked(runClaudeCli).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('token fetch 성공 시 buildChildEnv 에 token 이 전달되고 runClaudeCli 호출', async () => {
    const c = client('tk-X');
    await runAgent(env, { client: c });

    expect(c.getMyOAuthToken).toHaveBeenCalledOnce();
    expect(buildChildEnv).toHaveBeenCalledWith(expect.anything(), 'tk-X');
    expect(runClaudeCli).toHaveBeenCalledOnce();
  });

  it('token fetch 실패 시 spawn 안 함 + console.error 로그', async () => {
    const c = client(new Error('boom'));
    await runAgent(env, { client: c });

    expect(c.getMyOAuthToken).toHaveBeenCalledOnce();
    expect(runClaudeCli).not.toHaveBeenCalled();
  });
});
