import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./run-agent.js', () => ({
  runAgent: vi.fn().mockResolvedValue(undefined),
}));

import { handleEvent } from './event-handler.js';
import { runAgent } from './run-agent.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';
import type { WorkplaceApiClient } from '../clients/workplace-api.js';

const client = {
  addIssueComment: vi.fn(),
  updateIssueStatus: vi.fn(),
  getIssueDetail: vi.fn(),
  unassignSelf: vi.fn(),
  getCachedSelfUserId: vi.fn(),
  getMyOAuthToken: vi.fn(),
} as unknown as WorkplaceApiClient;

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('handleEvent', () => {
  beforeEach(() => {
    vi.mocked(runAgent).mockClear();
    vi.mocked(runAgent).mockResolvedValue(undefined);
  });

  it('issue.created → runAgent 1회 호출 (envelope, deps)', () => {
    const env: IssueEventEnvelope = {
      type: 'issue.created',
      payload: { ...common, status: 'TODO', priority: 'MID' },
    };
    handleEvent(env, { client });
    expect(runAgent).toHaveBeenCalledOnce();
    expect(runAgent).toHaveBeenCalledWith(env, { client });
  });

  it('issue.assigned → runAgent 호출', () => {
    handleEvent(
      {
        type: 'issue.assigned',
        payload: { ...common, added: common.assignees, removed: [] },
      },
      { client },
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.commented + AGENT actor → self-loop 차단', () => {
    handleEvent(
      {
        type: 'issue.commented',
        payload: {
          ...common,
          actor: { id: 999, username: 'ai', kind: 'AGENT' as const },
          commentId: 1,
          commentBody: '자기 코멘트',
        },
      },
      { client },
    );
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('issue.commented + HUMAN actor → runAgent 호출', () => {
    handleEvent(
      {
        type: 'issue.commented',
        payload: { ...common, commentId: 1, commentBody: '확인' },
      },
      { client },
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('issue.status_changed → runAgent 호출', () => {
    handleEvent(
      {
        type: 'issue.status_changed',
        payload: { ...common, previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
      },
      { client },
    );
    expect(runAgent).toHaveBeenCalledOnce();
  });

  it('runAgent reject 해도 handleEvent throw 안 함', async () => {
    vi.mocked(runAgent).mockRejectedValueOnce(new Error('boom'));
    expect(() =>
      handleEvent(
        {
          type: 'issue.created',
          payload: { ...common, status: 'TODO', priority: 'MID' },
        },
        { client },
      ),
    ).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
