import { describe, expect, it } from 'vitest';
import { buildUserMessage, formatKst } from './user-message.js';
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
    // WP-1219: 작업 방향만 알리고 끝내지 않게 — 담당 지정과 같은 「끝까지 하고 결과를 남긴다」 지시.
    expect(m).not.toContain('작업 방향을 코멘트로');
    expect(m).toContain('이번 실행 안에서 끝까지');
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
    // WP-1219: 시작 코멘트만 남기고 끝내던 지시를 고쳤다 — 이 실행 안에서 결과물을 코멘트로 남기고, 못 끝내면 이유를 남긴다.
    expect(m).not.toContain('시작 코멘트.');
    expect(m).toContain('이번 실행 안에서 끝까지');
    expect(m).toContain('다시 깨어나지 않습니다');
    expect(m).toContain('결과 코멘트 하나에 결과 전체');
    expect(m).toContain('끝내지 못한 이유');
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

  // WP-989: 반복 회차 지시문 — 회차 번호·KST 시각·본문·쓰기 금지(제안으로)·결과가 챗에 남는다는 안내.
  it('issue.recurring_run', () => {
    const m = buildUserMessage({
      type: 'issue.recurring_run',
      payload: {
        ...common,
        ownerUserId: 7,
        runId: '42-1790000000',
        runAt: '2026-09-21T23:13:20+09:00',
        round: 3,
        recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=MO', time: '23:13' },
        issueBody: '이번 주 진행 중 이슈를 정리해 줘',
      },
    } as IssueEventEnvelope);
    expect(m).toContain('[이벤트: issue.recurring_run]');
    expect(m).toContain('3회차');
    expect(m).toContain('2026-09-21(월) 23:13 KST');
    expect(m).toContain('WP-42');
    expect(m).toContain('이번 주 진행 중 이슈를 정리해 줘');
    expect(m).toContain('FREQ=WEEKLY;BYDAY=MO');
    expect(m).toContain('쓰기 작업');
    expect(m).toContain('「제안」');
    expect(m).toContain('이슈 챗에 남는');
    // 도구는 요청자 권한 — 「확인 필요」 우회 문구는 없다.
    expect(m).toContain('@alice');
    expect(m).toContain('권한으로 동작');
    expect(m).not.toContain('확인 필요');
  });

  it('issue.recurring_run — 본문 없음·회차 번호 없음', () => {
    const m = buildUserMessage({
      type: 'issue.recurring_run',
      payload: { ...common, ownerUserId: 7, runId: 'r', runAt: '2026-09-21T00:00:00Z', recurrence: { rrule: 'FREQ=DAILY', time: '09:00' }, issueBody: null },
    } as IssueEventEnvelope);
    expect(m).toContain('이번 회차 실행');
    expect(m).toContain('본문 없음');
    expect(m).toContain('2026-09-21(월) 09:00 KST');
  });

  it('formatKst — UTC 를 KST 로, 못 읽는 값은 그대로', () => {
    expect(formatKst('2026-12-31T15:30:00Z')).toBe('2027-01-01(금) 00:30 KST');
    expect(formatKst('oops')).toBe('oops');
  });
});
