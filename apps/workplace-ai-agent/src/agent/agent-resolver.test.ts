import { describe, expect, it } from 'vitest';
import { pickActingAgentId } from './agent-resolver.js';
import type { IssueEventEnvelope } from '../types/issue-events.js';

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
});
