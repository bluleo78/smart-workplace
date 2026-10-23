// 이슈 불러오기 실패 상태 — 빈 상태(「이슈가 없습니다」·「검색 결과가 없습니다」)와 구분한다(WP-858).
// 실패를 빈 목록으로 그리면 사용자가 이슈가 사라졌다고 오해해 다시 만들 수 있다. 빈 상태와 같은 4요소 배치(아이콘·제목·설명·액션)에
// 에러 아이콘을 둔다. 평면 목록·사이클 구간 목록·보드가 공유한다.
// - 일시 실패(5xx·네트워크): 「다시 시도」 — 다시 부르는 동안은 버튼을 잠그고 돌린다(연타가 진행 중 요청을 끊고 다시 보내지 않게).
// - 다시 보내도 같은 실패(4xx — 주소의 필터 값을 서버가 받지 못함 등): 다시 시도 대신 「필터 초기화」.

import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { apiErrorStatus, isPermanentClientStatus } from '../../../lib/api-error';
import { cn } from '../../../lib/utils';
import { useResetIssueFilters } from '../hooks/useResetIssueFilters';

/** 실패 상태가 읽는 쿼리 결과 — useQuery·useInfiniteQuery 결과 모두 맞는다. */
type FailedQuery = { error: unknown; isFetching: boolean; refetch: () => unknown };

export function IssueLoadErrorState({
  queries,
}: {
  /** 첫 로드에 실패한 쿼리들 — 첫 오류의 상태 코드로 다시 시도/필터 초기화를 가르고, 다시 시도는 모두 다시 부른다. */
  queries: FailedQuery[];
}) {
  const resetFilters = useResetIssueFilters();
  const permanent = isPermanentClientStatus(apiErrorStatus(queries[0]?.error));
  const retrying = queries.some((q) => q.isFetching);
  const onRetry = () => queries.forEach((q) => void q.refetch());
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 py-16 text-center"
      data-testid="issue-load-error"
    >
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">이슈를 불러오지 못했습니다</p>
        <p className="text-xs text-muted-foreground">
          {permanent
            ? '주소의 검색·필터 조건을 처리하지 못했어요. 필터를 초기화해 보세요.'
            : '일시적인 문제일 수 있어요. 잠시 뒤 다시 시도해 주세요.'}
        </p>
      </div>
      {permanent ? (
        <Button variant="outline" size="sm" onClick={resetFilters} data-testid="issue-load-reset-filter">
          필터 초기화
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying} data-testid="issue-load-retry">
          <RefreshCw className={cn('h-4 w-4', retrying && 'animate-spin')} aria-hidden="true" />
          다시 시도
        </Button>
      )}
    </div>
  );
}
