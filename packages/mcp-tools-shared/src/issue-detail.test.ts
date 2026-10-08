import { describe, expect, it } from 'vitest';
import { ISSUE_DETAIL_HISTORY_LIMIT, normalizeIssueDetail } from './issue-detail.js';

// 백엔드 IssueDetailResponse 형태(요약은 summary 중첩, comment 는 flat author 필드).
const raw = {
  issueKey: 'WP-12',
  summary: {
    id: 100,
    title: '로그인 버그',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    assignees: [{ id: 10, username: 'alice', name: 'Alice', kind: 'HUMAN' }],
    blockedBy: [{ number: 11, title: '선행작업', status: 'TODO', type: { id: 1, name: 'TASK' } }],
    blocks: [{ number: 13, title: '후속작업', status: 'TODO', type: null }],
    blocked: true,
  },
  body: '재현 절차...',
  comments: [
    { id: 1, body: '확인함', createdAt: '2026-07-10T00:00:00Z', authorId: 10, authorName: 'alice', authorKind: 'HUMAN' },
  ],
  history: [],
  attachments: [],
};

describe('normalizeIssueDetail', () => {
  it('summary 를 flatten 하고 issueKey/title/status/priority/assignees 를 top-level 로', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.issueKey).toBe('WP-12');
    expect(d.title).toBe('로그인 버그');
    expect(d.status).toBe('IN_PROGRESS');
    expect(d.priority).toBe('HIGH');
    expect(d.body).toBe('재현 절차...');
    // #833: 숫자 id 는 빼고 username·name·kind 만.
    expect(d.assignees).toEqual([{ username: 'alice', name: 'Alice', kind: 'HUMAN' }]);
  });

  it('의존성 필드를 summary 에서 top-level 로 lift', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.blocked).toBe(true);
    expect(d.blockedBy).toEqual([{ number: 11, title: '선행작업', status: 'TODO' }]);
    expect(d.blocks).toEqual([{ number: 13, title: '후속작업', status: 'TODO' }]);
  });

  it('comment 의 flat author 필드를 nested author 로 변환 — username 은 멤버 목록에서 찾고 없으면 null', () => {
    // authorName 은 표시 이름이라 username 자리에 넣지 않는다(WP-307).
    const known = normalizeIssueDetail(raw, { usernameById: new Map([[10, 'alice.k']]) });
    expect(known.comments).toEqual([
      {
        id: 1,
        body: '확인함',
        createdAt: '2026-07-10T09:00:00+09:00',
        updatedAt: null,
        author: { username: 'alice.k', name: 'alice', kind: 'HUMAN' },
      },
    ]);
    expect(normalizeIssueDetail(raw).comments[0].author).toEqual({ username: null, name: 'alice', kind: 'HUMAN' });
  });

  it('WP-307: 날짜·유형·라벨·마일스톤·부모·하위·작성자·커스텀 필드·첨부·이력을 싣는다', () => {
    const d = normalizeIssueDetail(
      {
        summary: {
          projectKey: 'WP',
          number: 5,
          title: 't',
          status: 'CANCELED',
          priority: 'LOW',
          assignees: [],
          dueDate: '2026-10-10',
          startDate: '2026-10-01',
          createdAt: '2026-09-30T23:30:00Z',
          updatedAt: '2026-10-07T15:30:00Z',
          closedAt: '2026-10-07T15:30:00Z',
          type: { id: 7, name: 'BUG', colorToken: 'RED', icon: 'Bug' },
          labels: [{ id: 1, name: '긴급' }],
          milestoneId: 9,
          parent: { number: 2, title: '에픽', status: 'TODO' },
          childCount: 0,
          customFields: [{ defId: 4, name: '고객사', type: 'TEXT', value: 'ACME' }],
        },
        reporter: { id: 3, username: 'bob', name: 'Bob', kind: 'AGENT' },
        attachments: [
          { fileId: 11, issueId: 5, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, attachedById: 3, attachedByName: 'Bob', attachedAt: '2026-10-01T00:00:00Z' },
        ],
        history: [
          { id: 1, actorId: 3, actorName: 'Bob', actorKind: 'AGENT', eventType: 'STATUS_CHANGED', fromValue: 'TODO', toValue: 'CANCELED', createdAt: '2026-10-07T15:30:00Z' },
          { id: 2, actorId: 3, actorName: 'Bob', actorKind: 'AGENT', eventType: 'LABELS_CHANGED', fromValue: null, toValue: '{"added":[{"id":1,"name":"긴급","colorToken":"RED"}],"removed":[]}', createdAt: '2026-10-07T15:31:00Z' },
        ],
      },
      { milestoneNameById: new Map([[9, 'v1.0']]), usernameById: new Map([[3, 'bob']]) },
    );
    expect(d).toMatchObject({
      issueKey: 'WP-5',
      type: 'BUG',
      dueDate: '2026-10-10',
      startDate: '2026-10-01',
      createdAt: '2026-10-01T08:30:00+09:00',
      updatedAt: '2026-10-08T00:30:00+09:00',
      closedAt: '2026-10-08T00:30:00+09:00',
      labels: ['긴급'],
      milestone: 'v1.0',
      parent: { issueKey: 'WP-2', title: '에픽', status: 'TODO' },
      children: null,
      reporter: { username: 'bob', name: 'Bob', kind: 'AGENT' },
      customFields: [{ name: '고객사', type: 'TEXT', value: 'ACME' }],
      attachments: [{ fileId: 11, name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, attachedBy: { username: 'bob', name: 'Bob', kind: null }, attachedAt: '2026-10-01T09:00:00+09:00' }],
      history: [
        { at: '2026-10-08T00:30:00+09:00', actor: { username: 'bob', name: 'Bob', kind: 'AGENT' }, event: 'STATUS_CHANGED', from: 'TODO', to: 'CANCELED' },
        { at: '2026-10-08T00:31:00+09:00', actor: { username: 'bob', name: 'Bob', kind: 'AGENT' }, event: 'LABELS_CHANGED', from: null, to: { added: [{ name: '긴급' }], removed: [] } },
      ],
    });
  });

  it('이력은 최근 것만 싣는다', () => {
    const history = Array.from({ length: ISSUE_DETAIL_HISTORY_LIMIT + 5 }, (_, i) => ({ eventType: `E${i}`, actorName: 'x' }));
    const d = normalizeIssueDetail({ summary: { title: 't' }, history });
    expect(d.history).toHaveLength(ISSUE_DETAIL_HISTORY_LIMIT);
    expect(d.history.at(-1)!.event).toBe(`E${ISSUE_DETAIL_HISTORY_LIMIT + 4}`);
  });

  it('의존성/코멘트 누락 시 기본값(빈 배열/false)', () => {
    const d = normalizeIssueDetail({ issueKey: 'WP-1', summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } });
    expect(d.blockedBy).toEqual([]);
    expect(d.blocks).toEqual([]);
    expect(d.blocked).toBe(false);
    expect(d.comments).toEqual([]);
  });
});
