// 무한 스크롤 목록 끝 공용 푸터 — sentinel + 로딩 표시 + 다음 페이지 실패 시 "다시 시도" (WP-182).
// 이슈 보드 컬럼(ColumnLoadMore)과 같은 규칙: 평소엔 끝에 닿으면 자동 로드, 실패하면 자동 로드를 멈추고
// (공용 훅이 실패 요청 무한 반복을 막는다) 사용자가 직접 다시 시도할 수 있게 버튼을 보인다.
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';

type LoadMoreFooterQuery = Pick<
  UseInfiniteQueryResult<InfiniteData<unknown>, Error>,
  'hasNextPage' | 'isFetching' | 'isFetchingNextPage' | 'isFetchNextPageError' | 'fetchNextPage'
>;

export function LoadMoreFooter({
  query,
  root = null,
  'data-testid': testId,
}: {
  query: LoadMoreFooterQuery;
  // sentinel 을 감싼 스크롤 컨테이너 — 목록이 자체 스크롤하면 반드시 넘긴다(useLoadMoreSentinel 참조).
  root?: Element | null;
  'data-testid'?: string;
}) {
  const ref = useLoadMoreSentinel(query, root);
  if (!query.hasNextPage) return null;
  return (
    <div ref={ref} data-testid={testId} className="py-3 text-center text-xs text-muted-foreground">
      {query.isFetchNextPageError ? (
        <button type="button" className="text-destructive underline" onClick={() => void query.fetchNextPage()}>
          불러오지 못했습니다 — 다시 시도
        </button>
      ) : (
        query.isFetchingNextPage && '불러오는 중…'
      )}
    </div>
  );
}
