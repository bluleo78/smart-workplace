// 무한 스크롤 sentinel — 반환한 ref 를 목록 끝 요소에 달면, 화면(여유 200px)에 들어올 때 다음 페이지를 받는다.
// 목록 뷰·보드 컬럼·위임 작업 목록이 같은 규칙을 쓰도록 공용화했다(#875).

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

type LoadMoreQuery = Pick<
  UseInfiniteQueryResult<InfiniteData<unknown>, Error>,
  'hasNextPage' | 'isFetching' | 'isFetchNextPageError' | 'fetchNextPage'
>;

export function useLoadMoreSentinel<T extends HTMLElement = HTMLDivElement>(query: LoadMoreQuery) {
  const ref = useRef<T | null>(null);
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = query;

  // isFetching 변경마다 observer 를 다시 붙이면 초기 교차 콜백이 재발화한다 → 로드 후에도 sentinel 이 보이면(짧은 목록)
  // 화면을 채우거나 마지막 페이지에 닿을 때까지 이어서 로드된다.
  // 다음 페이지 요청이 실패하면 멈춘다 — 안 그러면 같은 재발화 때문에 실패 요청을 무한 반복한다(재시도는 호출처 버튼).
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetching) void fetchNextPage();
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasNextPage, isFetching, isFetchNextPageError, fetchNextPage]);

  return ref;
}
