// 무한 스크롤 목록 끝 공용 푸터 — sentinel + 로딩 표시 + 다음 페이지 실패 시 "다시 시도" (WP-182).
// 평소엔 끝에 닿으면 자동 로드, 실패하면 자동 로드를 멈추고(공용 훅이 실패 요청 무한 반복을 막는다)
// 사용자가 직접 다시 시도할 수 있게 버튼을 보인다. 이슈 보드 컬럼·설정 목록·연락처 등이 함께 쓴다.
// 사용처는 오류 화면을 isLoadingError(첫 페이지 실패)일 때만 그려야 한다 — isError 는 다음 페이지 실패에도
// true 라서, 그걸로 분기하면 이미 받은 목록이 오류 화면으로 덮이고 이 푸터의 다시 시도도 사라진다.
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { type LoadMoreQuery, useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';
import { cn } from '@/lib/utils';

type LoadMoreFooterQuery = LoadMoreQuery &
  Pick<UseInfiniteQueryResult<InfiniteData<unknown>, Error>, 'isFetchingNextPage'>;

export function LoadMoreFooter({
  query,
  root = null,
  className,
  'data-testid': testId,
}: {
  query: LoadMoreFooterQuery;
  // sentinel 을 감싼 스크롤 컨테이너 — 목록이 자체 스크롤하면 반드시 넘긴다(useLoadMoreSentinel 참조).
  root?: Element | null;
  className?: string;
  'data-testid'?: string;
}) {
  const ref = useLoadMoreSentinel(query, root);
  if (!query.hasNextPage) return null;
  return (
    <div ref={ref} data-testid={testId} className={cn('py-3 text-center text-xs text-muted-foreground', className)}>
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
