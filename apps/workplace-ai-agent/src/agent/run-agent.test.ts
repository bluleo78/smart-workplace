import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// cli-runner 의 spawn 자체를 모킹 — runClaudeCli 를 vi.fn 으로 교체.
vi.mock('./cli-runner.js', () => ({
  buildCliArgs: vi.fn(() => ['--print', 'fake-msg']),
  buildChildEnv: vi.fn((p) => ({ ...p })),
  runClaudeCli: vi.fn().mockResolvedValue(undefined),
}));

import { runAgent } from './run-agent.js';
import { buildCliArgs, runClaudeCli } from './cli-runner.js';

const baseEnv = {
  CLAUDE_CODE_OAUTH_TOKEN: 'sub',
  WORKPLACE_AGENT_API_KEY: 'k',
  WORKPLACE_API_BASE_URL: 'http://x',
};

describe('runAgent', () => {
  beforeEach(() => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = baseEnv.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.WORKPLACE_AGENT_API_KEY = baseEnv.WORKPLACE_AGENT_API_KEY;
    process.env.WORKPLACE_API_BASE_URL = baseEnv.WORKPLACE_API_BASE_URL;
    vi.mocked(buildCliArgs).mockClear();
    vi.mocked(runClaudeCli).mockClear();
  });
  afterEach(() => {
    delete process.env.WORKPLACE_AI_MODEL;
    delete process.env.WORKPLACE_AI_MAX_TURNS;
    delete process.env.WORKPLACE_AI_TIMEOUT_MS;
  });

  it('runAgent 호출 시 buildCliArgs + runClaudeCli 각 1회', async () => {
    await runAgent({
      type: 'issue.created',
      payload: {
        projectKey: 'WP',
        issueKey: 'WP-1',
        issueId: 1,
        issueTitle: 't',
        actor: { id: 7, username: 'a', kind: 'HUMAN' },
        assignees: [],
        occurredAt: '2026-05-25T12:00:00Z',
        status: 'TODO',
        priority: 'MID',
      },
    });

    expect(buildCliArgs).toHaveBeenCalledOnce();
    expect(runClaudeCli).toHaveBeenCalledOnce();
    const arg = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(arg.userMessage).toContain('[이벤트: issue.created]');
    expect(arg.systemPrompt).toContain('AI Bot');
    expect(arg.maxTurns).toBe(10);
    expect(arg.model).toBe('claude-sonnet-4-6');
  });

  it('env override 가능 (WORKPLACE_AI_MODEL / MAX_TURNS)', async () => {
    process.env.WORKPLACE_AI_MODEL = 'override-model';
    process.env.WORKPLACE_AI_MAX_TURNS = '3';
    await runAgent({
      type: 'issue.assigned',
      payload: {
        projectKey: 'WP',
        issueKey: 'WP-1',
        issueId: 1,
        issueTitle: 't',
        actor: { id: 7, username: 'a', kind: 'HUMAN' },
        assignees: [],
        occurredAt: '2026-05-25T12:00:00Z',
        added: [],
        removed: [],
      },
    });
    const arg = vi.mocked(buildCliArgs).mock.calls[0][0];
    expect(arg.model).toBe('override-model');
    expect(arg.maxTurns).toBe(3);
  });
});
