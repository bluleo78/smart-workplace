// 이슈 코멘트 이모지 반응 토글(WP-504) — 채팅 useToggleReaction 과 같은 규칙을 이슈 상세 캐시에 적용한다.
//
// - 낙관적 패치: issueKeys.detail 캐시의 해당 코멘트 reactions 만 applyReaction 으로 고친다(다른 코멘트·필드는 참조 유지).
// - reacted 판정(#702): 클릭 시점 렌더 클로저가 아니라 toggle() 호출 시점의 최신 캐시로 한 번만 계산한다. 같은 칩을 빠르게
//   연속 클릭해도 각 클릭이 직전 클릭의 패치를 보고 add/remove 를 번갈아 고른다. 그래서 패치도 TanStack 의 onMutate(비동기로
//   늦게 돈다)가 아니라 toggle() 안에서 동기로 적용한다 — 두 번째 클릭이 첫 번째 패치를 반드시 보게 하려고.
// - 실패: 이 클릭 직전 스냅샷으로 되돌리고 토스트. 연속 클릭 중 하나만 실패하면 스냅샷이 뒤 클릭의 패치까지 덮을 수 있어
//   상세를 한 번 재조회해 서버와 맞춘다.
// - 반응자 목록 무효화는 서버 반영 뒤(onSettled) — onMutate 에서 하면 열린 호버 카드가 반영 전 목록을 30초 fresh 로 캐시한다.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { issueCommentsApi } from '../../api/issueComments';
import { handleApiError } from '../../lib/api-error';
import { applyReaction } from '../../lib/reactions';
import type { IssueDetailResponse } from '../../types/issue';
import { issueKeys } from './useIssues';

interface ToggleVars {
  commentId: number;
  emoji: string;
  reacted: boolean;
  // 이 클릭의 패치 직전 상세 캐시 — 실패 시 롤백용.
  snapshot: IssueDetailResponse | undefined;
  // 클릭 순간 상세 재조회가 진행 중이었는지 — 취소한 재조회를 서버 반영 뒤 다시 돌리기 위해.
  refetchCancelled: boolean;
}

/**
 * 상세 응답에서 commentId 코멘트의 반응만 토글한 새 객체를 돌려준다(순수 함수).
 * reacted=true 면 내 반응 취소(-1), false 면 추가(+1). 캐시가 없으면 그대로 undefined.
 */
export function patchCommentReactions(
  detail: IssueDetailResponse | undefined,
  commentId: number,
  emoji: string,
  reacted: boolean,
): IssueDetailResponse | undefined {
  if (!detail) return detail;
  const delta = reacted ? -1 : 1;
  return {
    ...detail,
    comments: detail.comments.map((c) =>
      // 구버전 서버 응답엔 reactions 가 없을 수 있어 빈 배열로 본다.
      c.id === commentId ? { ...c, reactions: applyReaction(c.reactions ?? [], emoji, delta, true) } : c,
    ),
  };
}

/** 최신 상세 캐시에서 내가 이 코멘트에 emoji 로 반응했는지. */
function isReactedNow(detail: IssueDetailResponse | undefined, commentId: number, emoji: string): boolean {
  const c = detail?.comments.find((x) => x.id === commentId);
  return c?.reactions?.find((r) => r.emoji === emoji)?.reacted ?? false;
}

export function useToggleCommentReaction(projectKey: string, issueNumber: number, issueId: number) {
  const qc = useQueryClient();
  const detailKey = issueKeys.detail(projectKey, issueNumber);

  const mutation = useMutation({
    mutationFn: ({ commentId, emoji, reacted }: ToggleVars) =>
      reacted
        ? issueCommentsApi.removeReaction(issueId, commentId, emoji)
        : issueCommentsApi.addReaction(issueId, commentId, emoji),

    onError: (err, { snapshot }) => {
      qc.setQueryData(detailKey, snapshot);
      qc.invalidateQueries({ queryKey: detailKey });
      // 서버 메시지(예: 반응 상한 초과)가 있으면 그것을, 없으면 기본 문구를 보여준다.
      handleApiError(err, '반응을 저장하지 못했어요');
    },

    // 내 토글은 SSE self-echo 에 기대지 않고 직접 반응자 목록을 무효화한다.
    onSettled: (_data, _err, { commentId, refetchCancelled }) => {
      qc.invalidateQueries({ queryKey: issueKeys.commentReactors(commentId) });
      // 클릭 때 취소한 재조회(다른 사람의 변경일 수 있음)는 내 반영이 끝난 뒤 다시 받아 놓친 변경이 없게 한다.
      if (refetchCancelled) qc.invalidateQueries({ queryKey: detailKey });
    },
  });

  return {
    toggle: (commentId: number, emoji: string) => {
      // 진행 중인 상세 재조회가 낙관적 패치를 반영 전 데이터로 덮지 않게 먼저 취소한다(onSettled 에서 다시 받는다).
      const refetchCancelled = qc.isFetching({ queryKey: detailKey }) > 0;
      if (refetchCancelled) void qc.cancelQueries({ queryKey: detailKey });
      const snapshot = qc.getQueryData<IssueDetailResponse>(detailKey);
      const reacted = isReactedNow(snapshot, commentId, emoji);
      qc.setQueryData<IssueDetailResponse>(detailKey, (old) => patchCommentReactions(old, commentId, emoji, reacted));
      mutation.mutate({ commentId, emoji, reacted, snapshot, refetchCancelled });
    },
  };
}
