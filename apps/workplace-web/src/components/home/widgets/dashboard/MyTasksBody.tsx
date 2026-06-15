import { Skeleton } from '@/components/ui/skeleton'
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries'
import type { IssueSearchResponse } from '@/types/issue'

import { WidgetError } from '../WidgetError'

// size=50 페이지 기준 카운트 — hasMore 면 "N+"(전체 카운트 엔드포인트 없음).
function count(data?: IssueSearchResponse): string {
  if (!data) return '–'
  return data.hasMore ? `${data.items.length}+` : String(data.items.length)
}

/** 내 작업 요약 본문 — 내 담당/워치 카운트. 프레임/딥링크는 Dashboard 가 담당. */
export default function MyTasksBody() {
  const assigned = useMyIssues({ assignee: 'me', size: 50 })
  const watched = useWatchedIssues()
  const loading = assigned.isLoading || watched.isLoading
  // 둘 중 하나라도 실패하면 카운트가 거짓 '–'(0건과 구분 불가)이므로 전체를 에러 처리(#205).
  const isError = assigned.isError || watched.isError

  if (loading) return <Skeleton className="h-12 w-full" />
  if (isError)
    return (
      <WidgetError
        onRetry={() => {
          assigned.refetch()
          watched.refetch()
        }}
        testId="dash-mytasks-error"
      />
    )

  return (
    <div className="flex gap-6" data-testid="dash-mytasks">
      <div className="text-center">
        <div className="text-2xl font-semibold text-ai-accent">{count(assigned.data)}</div>
        <div className="text-xs text-muted-foreground">내 담당</div>
      </div>
      <div className="text-center">
        <div className="text-2xl font-semibold">{count(watched.data)}</div>
        <div className="text-xs text-muted-foreground">워치</div>
      </div>
    </div>
  )
}
