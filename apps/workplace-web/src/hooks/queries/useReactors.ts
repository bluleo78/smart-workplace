// 이모지별 반응자 무한 목록(WP-106). 호버 카드 내용·전체 보기 탭 내용처럼 "열렸을 때만 마운트되는" 컴포넌트에서만 부른다
// — 칩마다 관찰자를 두면 긴 대화에서 스크롤 성능이 떨어진다. 호버 카드와 전체 보기가 같은 키를 써서 첫 페이지를 재사용하고,
// 30초 동안은 같은 대상을 다시 봐도 재요청하지 않는다(반응 변경 시엔 토글 훅·SSE 가 소스 키 접두사로 무효화).
// WP-504: 대상(채팅 메시지·이슈 코멘트)마다 조회 API 가 달라 ReactorSource 로 키 접두사·페이지 조회를 주입받는다.
import { useInfiniteQuery } from '@tanstack/react-query';

import type { ReactorSource } from '../../components/reactions/types';
import type { ReactorPage } from '../../types/messaging';

/** 반응자 캐시 유지 시간 — 짧게 두어 같은 대상 재호버 시 반복 요청만 막는다. */
const REACTORS_STALE_MS = 30_000;

export function useReactors(source: ReactorSource, emoji: string) {
  return useInfiniteQuery({
    // 키 = 소스 접두사 + 이모지 — 채팅은 messagingKeys.reactors(messageId, emoji) 와 같은 배열이 된다.
    queryKey: [...source.queryKey, emoji],
    queryFn: ({ pageParam }) => source.fetchPage(emoji, pageParam),
    initialPageParam: null as string | null,
    // 다음 커서가 없으면 undefined 를 돌려 hasNextPage 를 끈다.
    getNextPageParam: (last: ReactorPage) => last.nextCursor ?? undefined,
    staleTime: REACTORS_STALE_MS,
  });
}
