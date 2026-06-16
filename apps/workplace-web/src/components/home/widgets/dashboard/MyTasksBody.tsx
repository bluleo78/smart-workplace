import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries'
import type { IssueResponse, IssueSearchResponse } from '@/types/issue'

import { WidgetError } from '../WidgetError'

// size=50 페이지 기준 카운트 — hasMore 면 "N+"(전체 카운트 엔드포인트 없음).
function count(data?: IssueSearchResponse): string {
  if (!data) return '–'
  return data.hasMore ? `${data.items.length}+` : String(data.items.length)
}

/** 내 작업 요약 본문 — 내 담당/워치 카운트 + 내 담당 상위 행(행 클릭 시 이슈 상세). */
export default function MyTasksBody({ count: limit = 5 }: { count?: number }) {
  const assigned = useMyIssues({ assignee: 'me', size: 50 })
  const watched = useWatchedIssues()
  const loading = assigned.isLoading || watched.isLoading
  // 둘 중 하나라도 실패하면 카운트가 거짓 '–'(0건과 구분 불가)이므로 전체를 에러 처리(#205).
  const isError = assigned.isError || watched.isError

  // I3(a11y): 로딩 영역에 aria-busy + 라벨(스크린리더에 진행 안내).
  if (loading)
    return (
      <div aria-busy="true" aria-label="불러오는 중">
        <Skeleton className="h-12 w-full" />
      </div>
    )
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

  // 내 담당 이슈 상위 count 건 — 각 행을 이슈 상세로 딥링크(항목 수는 위젯 설정 기반).
  const top: IssueResponse[] = (assigned.data?.items ?? []).slice(0, limit)

  return (
    <div data-testid="dash-mytasks">
      <div className="mb-2 flex gap-6">
        <div className="text-center">
          <div className="text-2xl font-semibold text-ai-accent">{count(assigned.data)}</div>
          <div className="text-xs text-muted-foreground">내 담당</div>
        </div>
        <div className="text-center">
          {/* 내 담당과 동일한 시맨틱 토큰 — 두 지표를 동등한 레벨로 시각화. */}
          <div className="text-2xl font-semibold text-ai-accent">{count(watched.data)}</div>
          <div className="text-xs text-muted-foreground">워치</div>
        </div>
      </div>
      {/* 내 담당 이슈 행 — 클릭/Enter 시 해당 이슈 상세로 이동. */}
      <ul className="space-y-0.5">
        {top.map((issue) => (
          <li key={issue.id}>
            <Link
              to={`/projects/${issue.projectKey}/issues/${issue.number}`}
              aria-label={`이슈 열기: ${issue.title}`}
              className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                {issue.projectKey}-{issue.number}
              </span>
              <span className="truncate">{issue.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
