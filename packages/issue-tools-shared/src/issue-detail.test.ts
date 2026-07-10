import { describe, expect, it } from 'vitest';
import { normalizeIssueDetail } from './issue-detail.js';

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
    expect(d.assignees).toEqual([{ id: 10, username: 'alice', name: 'Alice', kind: 'HUMAN' }]);
  });

  it('의존성 필드를 summary 에서 top-level 로 lift', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.blocked).toBe(true);
    expect(d.blockedBy).toEqual([{ number: 11, title: '선행작업', status: 'TODO' }]);
    expect(d.blocks).toEqual([{ number: 13, title: '후속작업', status: 'TODO' }]);
  });

  it('comment 의 flat author 필드를 nested author 로 변환', () => {
    const d = normalizeIssueDetail(raw);
    expect(d.comments).toEqual([
      {
        id: 1,
        body: '확인함',
        createdAt: '2026-07-10T00:00:00Z',
        author: { id: 10, username: 'alice', name: 'alice', kind: 'HUMAN' },
      },
    ]);
  });

  it('의존성/코멘트 누락 시 기본값(빈 배열/false)', () => {
    const d = normalizeIssueDetail({ issueKey: 'WP-1', summary: { title: 't', status: 'TODO', priority: 'MID', assignees: [] } });
    expect(d.blockedBy).toEqual([]);
    expect(d.blocks).toEqual([]);
    expect(d.blocked).toBe(false);
    expect(d.comments).toEqual([]);
  });
});
