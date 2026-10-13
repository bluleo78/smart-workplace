import { describe, expect, it } from 'vitest';
import { pickActingAgentId } from './agent-resolver.js';
import {
  issueAssignedPayload,
  issueCommentedPayload,
  issueCreatedPayload,
  issueEventEnvelope,
  issueStatusChangedPayload,
  type IssueEventEnvelope,
} from '../types/issue-events.js';

const baseCommon = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: 't',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  occurredAt: '2026-05-26T12:00:00Z',
};

describe('pickActingAgentId', () => {
  it('API 가 지정한 actingAgentId 를 그대로 쓴다 — assignees 와 무관 (WP-371)', () => {
    const e: IssueEventEnvelope = {
      type: 'issue.created',
      payload: {
        ...baseCommon,
        assignees: [
          { id: 201, username: 'ai-a', kind: 'AGENT' },
          { id: 202, username: 'ai-b', kind: 'AGENT' },
        ],
        actingAgentId: 202,
        status: 'TODO',
        priority: 'MID',
      },
    };
    expect(pickActingAgentId(e)).toBe(202);
  });

  it('assignees 에 AGENT 가 없어도 actingAgentId 를 그대로 쓴다', () => {
    const e: IssueEventEnvelope = {
      type: 'issue.created',
      payload: {
        ...baseCommon,
        assignees: [{ id: 7, username: 'alice', kind: 'HUMAN' }],
        actingAgentId: 303,
        status: 'TODO',
        priority: 'MID',
      },
    };
    expect(pickActingAgentId(e)).toBe(303);
  });
});

describe('issue 이벤트 스키마 actingAgentId (WP-371, fail-closed)', () => {
  const base = {
    ...baseCommon,
    assignees: [],
    status: 'TODO',
    priority: 'MID',
    added: [],
    removed: [],
    commentId: 1,
    commentBody: 'c',
    previousStatus: 'TODO',
    newStatus: 'DONE',
  };
  it.each([
    ['issue.created', issueCreatedPayload],
    ['issue.assigned', issueAssignedPayload],
    ['issue.commented', issueCommentedPayload],
    ['issue.status_changed', issueStatusChangedPayload],
  ])('%s 는 actingAgentId 필수 양의 정수', (_t, schema) => {
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, actingAgentId: 9 }).success).toBe(true);
    expect(schema.safeParse({ ...base, actingAgentId: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, actingAgentId: 1.5 }).success).toBe(false);
  });

  it('envelope 도 actingAgentId 없으면 거절', () => {
    expect(
      issueEventEnvelope.safeParse({ type: 'issue.commented', payload: base }).success,
    ).toBe(false);
  });
});
