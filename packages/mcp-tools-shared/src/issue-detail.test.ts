import { describe, expect, it } from 'vitest';
import { ISSUE_DETAIL_COMMENT_HARD_LIMIT, ISSUE_DETAIL_COMMENT_LIMIT, ISSUE_DETAIL_HISTORY_LIMIT, normalizeIssueDetail } from './issue-detail.js';

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
    { id: 1, body: '확인함', createdAt: '2026-07-10T00:00:00Z', authorId: 10, authorName: 'alice', authorKind: 'HUMAN', authorUsername: 'alice.k' },
  ],
  history: [],
  attachments: [],
};

describe('normalizeIssueDetail agentWork (WP-377)', () => {
  it('summary.agentWork 를 출력 agentWork 로, 없으면 키가 없다', () => {
    const work = { worker: { id: 7, username: 'claude', name: 'Claude', kind: 'AI' }, tool: 'claude-code', state: 'WAITING', updatedAt: '2026-10-14T00:00:00Z' };
    const d = normalizeIssueDetail({ ...raw, summary: { ...raw.summary, agentWork: [work] } });
    expect(d.agentWork).toEqual([
      { worker: { username: 'claude', name: 'Claude', kind: 'AI' }, tool: 'claude-code', state: 'WAITING', updatedAt: '2026-10-14T09:00:00+09:00' },
    ]);
    expect(normalizeIssueDetail(raw)).not.toHaveProperty('agentWork');
  });
});

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
    // 이슈는 어디서나 issueKey 로 가리킨다 — 링크의 number 가 아니라(WP-353).
    expect(d.blockedBy).toEqual([{ issueKey: 'WP-11', title: '선행작업', status: 'TODO' }]);
    expect(d.blocks).toEqual([{ issueKey: 'WP-13', title: '후속작업', status: 'TODO' }]);
  });

  it('comment 의 flat author 필드를 nested author 로 변환 — username 은 authorUsername, 없으면 null', () => {
    // authorName 은 표시 이름이라 username 자리에 넣지 않는다(WP-307).
    const known = normalizeIssueDetail(raw);
    expect(known.comments).toEqual([
      {
        id: 1,
        body: '확인함',
        createdAt: '2026-07-10T09:00:00+09:00',
        updatedAt: null,
        author: { username: 'alice.k', name: 'alice', kind: 'HUMAN' },
      },
    ]);
    const noUsername = { ...raw, comments: [{ ...raw.comments[0], authorUsername: undefined }] };
    expect(normalizeIssueDetail(noUsername).comments[0].author).toEqual({ username: null, name: 'alice', kind: 'HUMAN' });
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
          milestoneName: 'v1.0',
          parent: { number: 2, title: '에픽', status: 'TODO' },
          childCount: 0,
          customFields: [{ defId: 4, name: '고객사', type: 'TEXT', value: 'ACME' }],
        },
        reporter: { id: 3, username: 'bob', name: 'Bob', kind: 'AGENT' },
        attachments: [
          { fileId: 11, issueId: 5, originalName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, attachedById: 3, attachedByName: 'Bob', attachedByUsername: 'bob', attachedAt: '2026-10-01T00:00:00Z' },
        ],
        history: [
          { id: 1, actorId: 3, actorName: 'Bob', actorKind: 'AGENT', actorUsername: 'bob', eventType: 'STATUS_CHANGED', fromValue: 'TODO', toValue: 'CANCELED', createdAt: '2026-10-07T15:30:00Z' },
          { id: 2, actorId: 3, actorName: 'Bob', actorKind: 'AGENT', actorUsername: 'bob', eventType: 'LABELS_CHANGED', fromValue: null, toValue: '{"added":[{"id":1,"name":"긴급","colorToken":"RED"}],"removed":[]}', createdAt: '2026-10-07T15:31:00Z' },
        ],
      },
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
      attachments: [{ attachmentId: 11, name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100, attachedBy: { username: 'bob', name: 'Bob', kind: null }, attachedAt: '2026-10-01T09:00:00+09:00' }],
      history: [
        { at: '2026-10-08T00:30:00+09:00', actor: { username: 'bob', name: 'Bob', kind: 'AGENT' }, event: 'STATUS_CHANGED', from: 'TODO', to: 'CANCELED' },
        { at: '2026-10-08T00:31:00+09:00', actor: { username: 'bob', name: 'Bob', kind: 'AGENT' }, event: 'LABELS_CHANGED', from: null, to: { added: [{ name: '긴급' }], removed: [] } },
      ],
    });
  });

  it('평문 이벤트(제목 등) 값은 { 나 [ 로 시작해도 JSON 으로 풀지 않는다', () => {
    const d = normalizeIssueDetail({
      summary: { title: 't' },
      history: [{ eventType: 'TITLE_CHANGED', actorName: 'x', fromValue: '{"id":3}', toValue: '["a"]' }],
    });
    expect(d.history[0]).toMatchObject({ from: '{"id":3}', to: '["a"]' });
  });

  it('첨부 이력 payload 의 fileId 도 뺀다', () => {
    const d = normalizeIssueDetail({
      summary: { title: 't' },
      history: [{ eventType: 'ATTACHMENTS_CHANGED', actorName: 'x', toValue: '{"added":[{"fileId":42,"originalName":"a.pdf"}],"removed":[]}' }],
    });
    expect(d.history[0].to).toEqual({ added: [{ originalName: 'a.pdf' }], removed: [] });
  });

  it('이력은 최근 것만 싣는다', () => {
    const history = Array.from({ length: ISSUE_DETAIL_HISTORY_LIMIT + 5 }, (_, i) => ({ eventType: `E${i}`, actorName: 'x' }));
    const d = normalizeIssueDetail({ summary: { title: 't' }, history });
    expect(d.history).toHaveLength(ISSUE_DETAIL_HISTORY_LIMIT);
    expect(d.history.at(-1)!.event).toBe(`E${ISSUE_DETAIL_HISTORY_LIMIT + 4}`);
  });

  it('이력이 잘리면 빠진 개수를 historyOmitted 로 알리고, 안 잘리면 키가 없다 (WP-353)', () => {
    const history = Array.from({ length: ISSUE_DETAIL_HISTORY_LIMIT + 5 }, (_, i) => ({ eventType: `E${i}`, actorName: 'x' }));
    expect(normalizeIssueDetail({ summary: { title: 't' }, history }).historyOmitted).toBe(5);
    expect(normalizeIssueDetail({ summary: { title: 't' }, history: history.slice(0, ISSUE_DETAIL_HISTORY_LIMIT) })).not.toHaveProperty('historyOmitted');
  });

  const manyComments = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, body: `코멘트 ${i + 1}`, authorName: 'x', authorKind: 'HUMAN', createdAt: '2026-07-10T00:00:00Z' }));

  it('코멘트는 최근 것만 싣고(오래된→최신 순서 유지) 빠진 개수를 commentsOmitted 로 알린다 (WP-353)', () => {
    const d = normalizeIssueDetail({ summary: { title: 't' }, comments: manyComments(ISSUE_DETAIL_COMMENT_LIMIT + 7) });
    expect(d.comments).toHaveLength(ISSUE_DETAIL_COMMENT_LIMIT);
    expect(d.comments[0].id).toBe(8); // 가장 오래된 7건이 빠짐
    expect(d.comments.at(-1)!.id).toBe(ISSUE_DETAIL_COMMENT_LIMIT + 7);
    expect(d.commentsOmitted).toBe(7);
  });

  it('코멘트가 상한 이하이면 전부 싣고 commentsOmitted 키가 없다(경계값 포함)', () => {
    for (const n of [0, 3, ISSUE_DETAIL_COMMENT_LIMIT]) {
      const d = normalizeIssueDetail({ summary: { title: 't' }, comments: manyComments(n) });
      expect(d.comments).toHaveLength(n);
      expect(d).not.toHaveProperty('commentsOmitted');
    }
  });

  it('allComments 로도 하드 상한(200)을 넘으면 최근 것만 싣고 commentsOmitted 로 알린다', () => {
    const d = normalizeIssueDetail({ summary: { title: 't' }, comments: manyComments(ISSUE_DETAIL_COMMENT_HARD_LIMIT + 25) }, { allComments: true });
    expect(d.comments).toHaveLength(ISSUE_DETAIL_COMMENT_HARD_LIMIT);
    expect(d.comments[0].id).toBe(26);
    expect(d.comments.at(-1)!.id).toBe(ISSUE_DETAIL_COMMENT_HARD_LIMIT + 25);
    expect(d.commentsOmitted).toBe(25);
    // 하드 상한 이하는 전부 싣는다.
    expect(normalizeIssueDetail({ summary: { title: 't' }, comments: manyComments(ISSUE_DETAIL_COMMENT_HARD_LIMIT) }, { allComments: true })).not.toHaveProperty('commentsOmitted');
  });

  it('allComments 면 코멘트 상한을 30 에서 풀어 더 싣는다(이력 상한은 그대로)', () => {
    const history = Array.from({ length: ISSUE_DETAIL_HISTORY_LIMIT + 2 }, (_, i) => ({ eventType: `E${i}`, actorName: 'x' }));
    const d = normalizeIssueDetail({ summary: { title: 't' }, comments: manyComments(ISSUE_DETAIL_COMMENT_LIMIT + 20), history }, { allComments: true });
    expect(d.comments).toHaveLength(ISSUE_DETAIL_COMMENT_LIMIT + 20);
    expect(d).not.toHaveProperty('commentsOmitted');
    expect(d.history).toHaveLength(ISSUE_DETAIL_HISTORY_LIMIT);
  });

  it('의존성/코멘트 누락 시 기본값(빈 배열/false)', () => {
    const d = normalizeIssueDetail({ issueKey: 'WP-1', summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } });
    expect(d.blockedBy).toEqual([]);
    expect(d.blocks).toEqual([]);
    expect(d.blocked).toBe(false);
    expect(d.comments).toEqual([]);
  });
});
