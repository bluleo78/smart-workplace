// issue.* SSE 이벤트 핸들러 — 통합 스트림 라우터(useEventStream)가 호출.
// 이슈 코멘트가 다른 탭/사용자에게 실시간 반영되지 않던 갭(#579)을 메운다.
// 백엔드 IssueSseDispatcher 가 이슈 참여자(watcher: 담당자·구경자·코멘트 작성자)에게 issue.commented 를 브로드캐스트하면,
// 열려 있는 이슈 상세 캐시(issueKeys.detail)를 무효화해 TanStack Query 가 최신 코멘트 목록을 재조회하도록 한다.
// 코멘트 수정/삭제(issue.comment_updated/issue.comment_deleted)도 동일하게 처리한다(#717) — 생성만 반영되고
// 수정/삭제는 다른 탭에서 새로고침 전까지 정지 데이터를 보여주던 갭을 메운다.
// 코멘트 반응 변경(issue.comment_reactions_changed, WP-504)은 상세(반응 집계)와 그 코멘트의 반응자 목록 캐시를 함께 무효화한다.

import type { QueryClient } from '@tanstack/react-query';

import { issueKeys } from './queries/useIssues';

interface IssueCommentedPayload {
  projectKey: string;
  issueNumber: number;
  // issue.comment_reactions_changed 에만 실린다 — 반응자 캐시 무효화 대상.
  commentId?: number;
}

const INVALIDATING_EVENTS = new Set([
  'issue.commented',
  'issue.comment_updated',
  'issue.comment_deleted',
  'issue.comment_reactions_changed',
]);

export function handleIssueEvent(qc: QueryClient, eventName: string, data: unknown) {
  if (INVALIDATING_EVENTS.has(eventName)) {
    const p = data as IssueCommentedPayload;
    if (!p?.projectKey || !Number.isFinite(p.issueNumber)) return;
    qc.invalidateQueries({ queryKey: issueKeys.detail(p.projectKey, p.issueNumber) });
    // 반응 변경이면 열려 있을 수 있는 반응자 호버 카드·전체 보기도 최신으로.
    if (eventName === 'issue.comment_reactions_changed' && typeof p.commentId === 'number' && Number.isFinite(p.commentId)) {
      qc.invalidateQueries({ queryKey: issueKeys.commentReactors(p.commentId) });
    }
  }
}
