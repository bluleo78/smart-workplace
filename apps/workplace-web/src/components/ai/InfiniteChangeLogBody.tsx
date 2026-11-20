// 메모리 변경 기록의 무한 스크롤 본문 — 개인 「AI가 정리한 기록」(WP-385)과 공용 「기록 보기」(WP-386)가 같은 모양·같은 상태 안내를 쓴다.
// 첫 묶음을 받는 중이면 항목 모양의 스켈레톤(디자인 시스템 06 §A), 첫 묶음이 실패하면 이유 문구 + 「다시 시도」(처음부터) —
// 다시 시도하는 동안에도 스켈레톤으로 바꾸지 않고 안내·초점을 그대로 둔다(WP-1820, lib/queryFailure),
// 다음 묶음이 실패하면 받은 목록은 그대로 두고 그 아래에 같은 공용 안내(그 묶음만 다시 받기)를 보인다 — 다시 받는 동안에도
// 안내·초점을 두고 단추를 잠근다(WP-1820 리뷰 후속). 토스트는 띄우지 않는다(자리에서 알린다).
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { type ReactNode, useRef } from 'react';

import { MemoryChangeLog } from '@/components/ai/MemoryChangeLog';
import type { MemoryChangeLogEntry } from '@/components/ai/memoryChangeLogEntry';
import { LoadErrorState } from '@/components/LoadErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import { FOCUSABLE } from '@/hooks/useDialogFocusRestore';
import { type LoadMoreQuery, useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';
import { failedWithoutData } from '@/lib/queryFailure';

/** 본문이 읽는 무한 쿼리 상태 — 두 기록 쿼리(개인·공용)가 모두 만족한다. */
type ChangeLogQuery = LoadMoreQuery &
  Pick<
    UseInfiniteQueryResult<InfiniteData<unknown>, Error>,
    'data' | 'isPending' | 'isFetching' | 'isFetchingNextPage' | 'errorUpdateCount' | 'isPlaceholderData'
  > & { refetch: () => unknown };

export function InfiniteChangeLogBody({
  query,
  entries,
  onUndo,
  isUndoing,
  scrollRoot,
  testIdPrefix,
  empty,
}: {
  query: ChangeLogQuery;
  entries: readonly MemoryChangeLogEntry[];
  onUndo: (entry: MemoryChangeLogEntry) => Promise<unknown>;
  isUndoing: (id: number) => boolean;
  /** 인피니트 스크롤 sentinel 의 root — 대화상자·시트의 스크롤 영역(뷰포트로 두면 끝에 닿아야 로드된다, useLoadMoreSentinel 참고). */
  scrollRoot: Element | null;
  /** data-testid 접두사 — `-log`·`-sentinel`·`-loading`·`-error` 를 붙인다. */
  testIdPrefix: string;
  /** 다 받았는데 기록이 없을 때 목록 대신 보일 안내(생략하면 빈 목록 그대로). */
  empty?: ReactNode;
}) {
  const sentinel = useLoadMoreSentinel(query, scrollRoot);
  // 첫 묶음 실패 판정 — 다시 부르는 중(pending)에도 참이라 안내가 사라지지 않는다.
  const firstFailed = failedWithoutData(query);
  const showEmpty = empty != null && query.data != null && entries.length === 0;
  // 다음 묶음 다시 시도를 누른 때 받아 둔 기록 수 — 성공하면 그 자리(새로 이어 붙은 첫 기록)로 초점을 보낸다.
  const loadedAtRetry = useRef(0);
  /**
   * 새로 이어 붙은 첫 기록의 첫 조작 요소(출처 링크·되돌리기), 없으면 그 기록 자체(li, tabIndex -1).
   * 새 기록이 없으면(0건) 받아 둔 마지막 기록으로 — 목록 맨 위로 튀거나 초점이 body 로 빠지지 않게(WP-1820 반려 수정).
   */
  const firstNewEntryControl = () => {
    const items = sentinel.current?.previousElementSibling?.querySelectorAll<HTMLElement>('[data-testid="memory-log-item"]');
    const item = items?.[loadedAtRetry.current] ?? items?.[loadedAtRetry.current - 1];
    return item?.querySelector<HTMLElement>(FOCUSABLE) ?? item ?? null;
  };
  return (
    <>
      {showEmpty ? (
        empty
      ) : (
        <MemoryChangeLog entries={entries} onUndo={onUndo} isUndoing={isUndoing} testId={`${testIdPrefix}-log`} />
      )}
      <div ref={sentinel} data-testid={`${testIdPrefix}-sentinel`} aria-hidden className="h-px" />
      {/* 첫 묶음 실패가 먼저 — 실패 뒤 다시 시도 중이면 스켈레톤 대신 안내를 남긴다. 첫 진입 로딩은 실패 전이라 스켈레톤을 본다 */}
      {!firstFailed && !query.data && (query.isPending || query.isFetching) && <ChangeLogSkeleton testId={`${testIdPrefix}-loading`} />}
      {/* 다음 묶음 실패 뒤 다시 받는 중에는 아래 안내가 잠긴 단추로 진행을 알린다 — 「불러오는 중…」을 겹쳐 보이지 않는다 */}
      {query.isFetchingNextPage && !query.isFetchNextPageError && (
        <p className="py-2 text-center text-xs text-muted-foreground">불러오는 중…</p>
      )}
      {/* 터치 기기(바텀시트)에서는 다음 묶음 안내와 같게 다시 시도를 44px 로 둔다 */}
      {firstFailed && (
        <LoadErrorState
          variant="inline"
          title="기록을 불러오지 못했어요"
          queries={[query]}
          retryClassName="pointer-coarse:h-11"
          testId={`${testIdPrefix}-error`}
        />
      )}
      {/* 다음 묶음 실패 — 받은 목록은 두고 그 묶음만 다시 받는다(onRetry). 다시 받는 동안 단추를 잠근다(retrying) */}
      {query.isFetchNextPageError && (
        <LoadErrorState
          variant="inline"
          title="다음 기록을 불러오지 못했어요"
          onRetry={() => {
            loadedAtRetry.current = entries.length;
            void query.fetchNextPage();
          }}
          retrying={query.isFetchingNextPage}
          retryClassName="pointer-coarse:h-11"
          focusAfterRetry={firstNewEntryControl}
          testId={`${testIdPrefix}-error`}
        />
      )}
    </>
  );
}

/** 첫 묶음을 받는 동안의 자리 표시 — 기록 항목(아이콘 + 두 줄)과 같은 모양으로 3줄. 스크린리더에는 "불러오는 중" 한 번만 읽힌다. */
function ChangeLogSkeleton({ testId }: { testId: string }) {
  return (
    <div data-testid={testId} role="status" aria-label="기록을 불러오는 중" className="space-y-1">
      <Skeleton className="h-4 w-12" />
      <ul aria-hidden className="divide-y rounded-md border">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-start gap-3 px-3 py-2.5">
            <Skeleton className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
