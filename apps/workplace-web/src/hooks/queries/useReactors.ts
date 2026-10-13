// 이모지별 반응자 무한 목록(WP-106). 호버 카드 내용·전체 보기 탭 내용처럼 "열렸을 때만 마운트되는" 컴포넌트에서만 부른다
// — 칩마다 관찰자를 두면 긴 대화에서 스크롤 성능이 떨어진다. 호버 카드와 전체 보기가 같은 키를 써서 첫 페이지를 재사용하고,
// 30초 동안은 같은 메시지를 다시 봐도 재요청하지 않는다(반응 변경 시엔 useToggleReaction·SSE 가 무효화).
import { useInfiniteQuery } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import type { ReactorPage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

/** 반응자 캐시 유지 시간 — 짧게 두어 같은 메시지 재호버 시 반복 요청만 막는다. */
const REACTORS_STALE_MS = 30_000;

export function useReactors(messageId: number, emoji: string) {
  return useInfiniteQuery({
    queryKey: messagingKeys.reactors(messageId, emoji),
    queryFn: ({ pageParam }) =>
      messagingApi.listReactors(messageId, emoji, pageParam).then((r) => r.data),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ReactorPage) => last.nextCursor ?? undefined,
    staleTime: REACTORS_STALE_MS,
  });
}
