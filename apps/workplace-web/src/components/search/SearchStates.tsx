// 통합 검색 팔레트(WP-1353)의 공용 상태 조각 — 스켈레톤·실패(다시 시도)·빈 결과.
import { Skeleton } from '@/components/ui/skeleton'

/** 결과 줄 모양의 스켈레톤 — 로딩 중 레이아웃이 튀지 않게. */
export function RowSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1" aria-hidden data-testid="global-search-loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}

/** 한 쪽(또는 한 묶음)을 못 불러왔을 때 — 그 조회만 다시 시도한다. */
export function RetryNotice({ onRetry, testId }: { onRetry: () => void; testId: string }) {
  return (
    <p className="flex items-center gap-1 px-2 py-2 text-xs text-destructive" data-testid={testId}>
      불러오지 못했어요 ·
      <button type="button" onClick={onRetry} className="underline hover:no-underline">
        다시 시도
      </button>
    </p>
  )
}
