import { describe, expect, it } from 'vitest';
import { pickActingAgentId } from './agent-resolver.js';
import {
  issueAssignedPayload,
  issueCommentedPayload,
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

function env(assignees: { id: number; username: string; kind: 'HUMAN' | 'AGENT' }[]): IssueEventEnvelope {
  return {
    type: 'issue.created',
    payload: { ...baseCommon, assignees, status: 'TODO', priority: 'MID' },
  };
}

describe('pickActingAgentId', () => {
  it('1 AGENT → 그 id', () => {
    expect(pickActingAgentId(env([{ id: 201, username: 'ai', kind: 'AGENT' }]))).toBe(201);
  });

  it('AGENT 없음 (HUMAN only) → null', () => {
    expect(pickActingAgentId(env([{ id: 7, username: 'alice', kind: 'HUMAN' }]))).toBeNull();
  });

  it('빈 assignees → null', () => {
    expect(pickActingAgentId(env([]))).toBeNull();
  });

  it('여러 AGENT → 첫 번째 id', () => {
    expect(
      pickActingAgentId(
        env([
          { id: 7, username: 'alice', kind: 'HUMAN' },
          { id: 201, username: 'ai-a', kind: 'AGENT' },
          { id: 202, username: 'ai-b', kind: 'AGENT' },
        ]),
      ),
    ).toBe(201);
  });

  it('actingAgentId 가 있으면 assignees 순서와 무관하게 그 id (WP-371)', () => {
    const e = env([
      { id: 201, username: 'ai-a', kind: 'AGENT' },
      { id: 202, username: 'ai-b', kind: 'AGENT' },
    ]);
    e.payload = { ...e.payload, actingAgentId: 202 };
    expect(pickActingAgentId(e)).toBe(202);
  });

  it('actingAgentId 가 있으면 assignees 에 AGENT 가 없어도 그 id', () => {
    const e = env([{ id: 7, username: 'alice', kind: 'HUMAN' }]);
    e.payload = { ...e.payload, actingAgentId: 303 };
    expect(pickActingAgentId(e)).toBe(303);
  });
});

describe('issue 이벤트 스키마 actingAgentId (WP-371)', () => {
  const base = {
    ...baseCommon,
    assignees: [],
    added: [],
    removed: [],
    commentId: 1,
    commentBody: 'c',
    previousStatus: 'TODO',
    newStatus: 'DONE',
  };
  it.each([
    ['issue.assigned', issueAssignedPayload],
    ['issue.commented', issueCommentedPayload],
    ['issue.status_changed', issueStatusChangedPayload],
  ])('%s 는 actingAgentId 선택적 양의 정수', (_t, schema) => {
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, actingAgentId: 9 }).success).toBe(true);
    expect(schema.safeParse({ ...base, actingAgentId: -1 }).success).toBe(false);
  });
});
