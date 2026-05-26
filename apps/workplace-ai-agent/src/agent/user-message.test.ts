import { describe, expect, it } from 'vitest';
import { buildUserMessage } from './user-message.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
};

describe('buildUserMessage', () => {
  it('issue.created', () => {
    const m = buildUserMessage({
      type: 'issue.created',
      payload: { ...common, status: 'TODO', priority: 'MID' },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.created]');
    expect(m).toContain('WP-42');
    expect(m).toContain('alice');
  });

  it('issue.assigned', () => {
    const m = buildUserMessage({
      type: 'issue.assigned',
      payload: { ...common, added: common.assignees, removed: [] },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.assigned]');
    expect(m).toContain('update_status');
  });

  it('issue.commented', () => {
    const m = buildUserMessage({
      type: 'issue.commented',
      payload: { ...common, commentId: 1, commentBody: '확인 부탁' },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.commented]');
    expect(m).toContain('"확인 부탁"');
  });

  it('issue.status_changed', () => {
    const m = buildUserMessage({
      type: 'issue.status_changed',
      payload: { ...common, previousStatus: 'TODO', newStatus: 'IN_PROGRESS' },
    } as IssueEventEnvelope);
    expect(m).toContain('TODO → IN_PROGRESS');
  });
});
