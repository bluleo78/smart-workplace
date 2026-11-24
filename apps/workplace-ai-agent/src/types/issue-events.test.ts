import { describe, expect, it } from 'vitest';
import { issueEventEnvelope } from './issue-events.js';

// WP-1994: issue.assigned 의 선택 칸 workflow — 워크플로우 노드 깨우기에서만 실린다.
const base = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' }],
  occurredAt: '2026-05-25T12:00:00Z',
  actingAgentId: 201,
  added: [{ id: 201, username: 'ai-bot', kind: 'AGENT' }],
  removed: [],
};
const parse = (extra: Record<string, unknown>) =>
  issueEventEnvelope.safeParse({ type: 'issue.assigned', payload: { ...base, ...extra } });

describe('issueAssignedPayload.workflow', () => {
  it('workflow 가 있으면 값을 보존한다', () => {
    const r = parse({ workflow: { runId: 7, nodeKey: 'dev' } });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'issue.assigned') expect(r.data.payload.workflow).toEqual({ runId: 7, nodeKey: 'dev' });
  });
  it('workflow 가 없거나 null 이어도 통과한다(옛 api)', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ workflow: null }).success).toBe(true);
  });
  it('nodeKey 빈 문자열·runId 0 은 거절한다', () => {
    expect(parse({ workflow: { runId: 7, nodeKey: '' } }).success).toBe(false);
    expect(parse({ workflow: { runId: 0, nodeKey: 'dev' } }).success).toBe(false);
  });
});
