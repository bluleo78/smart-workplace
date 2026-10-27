// 무한 쿼리의 남은 페이지를 마지막까지 차례로 받는다(WP-996) — 전량이 필요한 화면(그룹 보드·종료 에픽·타임라인)이 함께 쓴다.
//
// 다음 요청은 「아직 더 있음 + 지금 요청 중 아님 + 다음 페이지 실패 아님」으로 정하고, 응답이 올 때마다(dataUpdatedAt) 다시 판정한다.
// 예전엔 화면마다 「요청 중 표시가 true → false 로 바뀜」으로만 다시 판정했는데, 응답이 한 번 그리는 사이에 오면(빠른 로컬 서버·캐시)
// true 가 그려지지 않아 의존값이 그대로라 3페이지부터 멈췄다. 새로 고침(invalidate)이 같은 페이지 수로 끝나는 경우도 같다.
// - 요청 중 판정은 isFetching(전체 새로 고침 포함)으로 한다 — isFetchingNextPage 로 보면 새로 고침 도중 다음 페이지를 불러 그 새로 고침을 취소한다.
// - 다음 페이지가 실패하면 멈춘다 — 안 그러면 요청 중 해제가 판정을 다시 돌려 끝없이 재요청한다. 다시 시도는 화면이 fetchNextPage 로 한다.
import type { InfiniteQueryObserverResult } from '@tanstack/react-query';
import { useEffect } from 'react';

type PagedQuery = Pick<
  InfiniteQueryObserverResult,
  'hasNextPage' | 'isFetching' | 'isFetchNextPageError' | 'fetchNextPage' | 'dataUpdatedAt'
>;

export function useFetchAllPages(query: PagedQuery, enabled = true) {
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage, dataUpdatedAt } = query;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetching && !isFetchNextPageError) void fetchNextPage();
    // dataUpdatedAt 은 판정에 쓰지 않지만, 응답이 올 때마다 다시 판정하려고 의존성에 둔다.
  }, [enabled, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage, dataUpdatedAt]);
}
