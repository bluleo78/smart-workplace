// issue.* SSE 이벤트 핸들러 — 통합 스트림 라우터(useEventStream)가 호출.
// 이슈 코멘트가 다른 탭/사용자에게 실시간 반영되지 않던 갭(#579)을 메운다.
// 백엔드 IssueSseDispatcher 가 이슈 참여자(watcher: 담당자·구경자·코멘트 작성자)에게 issue.commented 를 브로드캐스트하면,
// 열려 있는 이슈 상세 캐시(issueKeys.detail)를 무효화해 TanStack Query 가 최신 코멘트 목록을 재조회하도록 한다.
// 코멘트 수정/삭제(issue.comment_updated/issue.comment_deleted)도 동일하게 처리한다(#717) — 생성만 반영되고
// 수정/삭제는 다른 탭에서 새로고침 전까지 정지 데이터를 보여주던 갭을 메운다.
// 이슈 생성(issue.created)은 프로젝트 멤버 전원에게 오며 목록 캐시를 무효화한다(WP-36) — AI Chat(MCP·확인카드)으로
// 만든 이슈는 브라우저 mutation 을 거치지 않아 useCreateIssue 의 onSuccess 무효화가 일어나지 않기 때문.

import type { QueryClient } from '@tanstack/react-query';

import { issueKeys } from './queries/useIssues';

interface IssueCommentedPayload {
  projectKey: string;
  issueNumber: number;
}

const INVALIDATING_EVENTS = new Set([
  'issue.commented',
  'issue.comment_updated',
  'issue.comment_deleted',
]);

interface IssueCreatedPayload {
  projectKey: string;
}

export function handleIssueEvent(qc: QueryClient, eventName: string, data: unknown) {
  if (INVALIDATING_EVENTS.has(eventName)) {
    const p = data as IssueCommentedPayload;
    if (!p?.projectKey || !Number.isFinite(p.issueNumber)) return;
    qc.invalidateQueries({ queryKey: issueKeys.detail(p.projectKey, p.issueNumber) });
    return;
  }
  if (eventName === 'issue.created') {
    // 새 이슈는 detail 캐시가 없으므로 목록만 무효화 — useCreateIssue.onSuccess 와 같은 범위 + 내 이슈 목록.
    const p = data as IssueCreatedPayload;
    if (!p?.projectKey) return;
    qc.invalidateQueries({ queryKey: issueKeys.lists(p.projectKey) });
    qc.invalidateQueries({ queryKey: issueKeys.search(p.projectKey) });
    qc.invalidateQueries({ queryKey: ['me-issues'] });
  }
}
