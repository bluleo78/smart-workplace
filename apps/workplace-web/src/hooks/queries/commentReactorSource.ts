// 이슈 코멘트 반응자 소스(WP-504) — 공용 반응 컴포넌트(components/reactions)에 코멘트 반응자 조회를 주입한다.
// 키 접두사를 issueKeys.commentReactors(commentId) 로 두어, 토글 훅(onSettled)·SSE(issue.comment_reactions_changed)의
// 무효화가 useReactors 가 이모지를 덧붙인 키에 그대로 닿게 한다.
import { issueCommentsApi } from '../../api/issueComments';
import type { ReactorSource } from '../../components/reactions/types';
import { issueKeys } from './useIssues';

/** 코멘트 하나의 반응자 소스. 첫 페이지(cursor=null)는 커서 없이 조회한다. */
export function commentReactorSource(issueId: number, commentId: number): ReactorSource {
  return {
    queryKey: issueKeys.commentReactors(commentId),
    fetchPage: (emoji, cursor) =>
      issueCommentsApi.listReactors(issueId, commentId, emoji, cursor ?? undefined).then((r) => r.data),
  };
}
