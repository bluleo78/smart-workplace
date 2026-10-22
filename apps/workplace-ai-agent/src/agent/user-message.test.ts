import { describe, expect, it } from 'vitest';
import { buildUserMessage } from './user-message.js';
import { issueEventEnvelope, type IssueEventEnvelope } from '../types/issue-events.js';

const common = {
  projectKey: 'WP',
  issueKey: 'WP-42',
  issueId: 42,
  issueTitle: '분석',
  actor: { id: 7, username: 'alice', kind: 'HUMAN' as const },
  assignees: [{ id: 201, username: 'ai-bot', kind: 'AGENT' as const }],
  occurredAt: '2026-05-25T12:00:00Z',
  actingAgentId: 201,
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
    expect(m).toContain("update_issue 의 status 를 'IN_PROGRESS'");
    expect(m).not.toContain('update_status');
    expect(m).toContain('ok 가 false');
    expect(m).toContain("results.content 가 'failed' 로 시작");
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

  // WP-807: 같은 범주 안의 상태 이름도 알 수 있게 이름이 오면 범주와 함께 보여 준다.
  it('issue.status_changed — 상태 이름이 오면 범주와 함께 보여 준다', () => {
    const m = buildUserMessage({
      type: 'issue.status_changed',
      payload: {
        ...common,
        previousStatus: 'TODO',
        newStatus: 'IN_PROGRESS',
        previousStatusName: '할 일',
        newStatusName: '검토 중',
      },
    } as IssueEventEnvelope);
    expect(m).toContain('할 일(TODO) → 검토 중(IN_PROGRESS)');
  });

  // 이름 필드는 선택이다 — 구 API 페이로드(이름 없음)도, 이름이 있는 새 페이로드도 스키마를 통과해야 한다.
  it('issue.status_changed 스키마는 상태 이름을 선택 필드로 받는다', () => {
    const base = { ...common, previousStatus: 'TODO', newStatus: 'DONE' };
    expect(issueEventEnvelope.safeParse({ type: 'issue.status_changed', payload: base }).success).toBe(true);
    const parsed = issueEventEnvelope.parse({
      type: 'issue.status_changed',
      payload: { ...base, previousStatusName: '할 일', newStatusName: '배포 완료' },
    });
    expect(parsed.type === 'issue.status_changed' && parsed.payload.newStatusName).toBe('배포 완료');
  });
});
