import { describe, expect, it } from 'vitest';

import type { IssueCommentResponse, IssueDetailResponse } from '../../types/issue';
import { commentReactorSource } from './commentReactorSource';
import { issueKeys } from './useIssues';
import { patchCommentReactions } from './useToggleCommentReaction';

// 테스트용 코멘트 — 반응 집계만 다르게 준다.
function comment(id: number, reactions?: IssueCommentResponse['reactions']): IssueCommentResponse {
  return {
    id, issueId: 7, authorId: 1, authorName: '홍길동', authorKind: 'HUMAN',
    body: `코멘트 ${id}`, createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z',
    reactions: reactions as IssueCommentResponse['reactions'],
  };
}

function detail(comments: IssueCommentResponse[]): IssueDetailResponse {
  return {
    summary: { id: 7 } as IssueDetailResponse['summary'],
    body: '본문', comments, history: [], attachments: [],
    viewerCanEditContent: true, viewerCanEditWorkflow: true, viewerCanDelete: false,
  };
}

describe('patchCommentReactions', () => {
  it('미반응 이모지를 누르면 해당 코멘트에만 count+1·reacted=true 로 추가된다', () => {
    const other = comment(2, [{ emoji: '👍', count: 3, reacted: false }]);
    const before = detail([comment(1, []), other]);
    const after = patchCommentReactions(before, 1, '🎉', false)!;

    expect(after.comments[0].reactions).toEqual([{ emoji: '🎉', count: 1, reacted: true }]);
    // 다른 코멘트·필드는 같은 참조 그대로
    expect(after.comments[1]).toBe(other);
    expect(after.history).toBe(before.history);
    expect(after.summary).toBe(before.summary);
    expect(after.body).toBe('본문');
    // 원본은 변하지 않는다(불변 패치)
    expect(before.comments[0].reactions).toEqual([]);
  });

  it('이미 반응한 이모지면 count-1, 0 이 되면 칩을 없앤다', () => {
    const before = detail([comment(1, [
      { emoji: '👍', count: 2, reacted: true },
      { emoji: '❤️', count: 1, reacted: true },
    ])]);
    const a = patchCommentReactions(before, 1, '👍', true)!;
    expect(a.comments[0].reactions).toEqual([
      { emoji: '👍', count: 1, reacted: false },
      { emoji: '❤️', count: 1, reacted: true },
    ]);
    const b = patchCommentReactions(a, 1, '❤️', true)!;
    expect(b.comments[0].reactions).toEqual([{ emoji: '👍', count: 1, reacted: false }]);
  });

  it('reactions 가 없는 구버전 응답도 빈 배열로 보고 패치한다', () => {
    const after = patchCommentReactions(detail([comment(1, undefined)]), 1, '👍', false)!;
    expect(after.comments[0].reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }]);
  });

  it('캐시가 없으면 undefined 를 그대로 돌려준다', () => {
    expect(patchCommentReactions(undefined, 1, '👍', false)).toBeUndefined();
  });
});

describe('commentReactorSource', () => {
  it('키 접두사는 issueKeys.commentReactors(commentId) — 토글·SSE 무효화가 닿는다', () => {
    expect(commentReactorSource(7, 99).queryKey).toEqual(['issues', 'comment-reactors', 99]);
    expect(commentReactorSource(7, 99).queryKey).toEqual(issueKeys.commentReactors(99));
  });
});
