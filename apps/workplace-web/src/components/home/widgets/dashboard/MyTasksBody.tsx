import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries'
import { formatRelativeTime } from '@/lib/formatters'
import { buildMyTaskRows, dueLabel, type MyTaskBucket } from '@/lib/myTasks'

import { WidgetError } from '../WidgetError'

// 버킷별 행 앞 아이콘 — 위급도를 한눈에. (텍스트 글리프로 토큰 의존 없이 표기)
const BUCKET_ICON: Record<MyTaskBucket, string> = {
  due: '⏰',
  blocked: '🚧',
  ai_followup: '🤖',
  mention: '💬',
  in_progress: '▸',
  todo: '○',
  watched: '·',
}

/** 내 작업 위젯 본문 — 나를 기다리는 열린 루프를 위급도 순 리스트로, 비면 긍정적 빈 상태로 렌더. */
export default function MyTasksBody({ count: limit = 5 }: { count?: number }) {
  const assigned = useMyIssues({ assignee: 'me', size: 50 })
  const watched = useWatchedIssues()
  const loading = assigned.isLoading || watched.isLoading
  // 둘 중 하나라도 실패하면 분류가 거짓이 되므로 전체를 에러 처리(#205).
  const isError = assigned.isError || watched.isError

  // I3(a11y): 로딩 영역에 aria-busy + 라벨.
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

  const now = new Date()
  const result = buildMyTaskRows(
    assigned.data?.items ?? [],
    watched.data?.items ?? [],
    limit,
    now,
  )

  // 행별 우측 메타 — 버킷에 따라 마감/대기/진행중/상대시간.
  function meta(bucket: MyTaskBucket, dueDate: string | null, updatedAt: string) {
    if (bucket === 'due' && dueDate)
      return <span className="shrink-0 text-xs font-semibold text-destructive">{dueLabel(dueDate, now)}</span>
    if (bucket === 'blocked') return <span className="shrink-0 text-xs text-muted-foreground">대기</span>
    if (bucket === 'in_progress')
      return <span className="shrink-0 rounded-full bg-ai-accent/10 px-2 py-0.5 text-[10px] text-ai-accent">진행중</span>
    if (bucket === 'watched')
      return <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(updatedAt)}</span>
    return null
  }

  return (
    <div data-testid="dash-mytasks">
      {/* 헤더 부제 — 기다리는 건수 또는 워치 총량 (형제 위젯과 동일한 mb-2 text-sm) */}
      <div className="mb-2 text-sm text-muted-foreground">
        {result.isEmpty ? `워치 ${result.watchedTotal}` : `${result.waitingCount}건이 나를 기다림`}
      </div>

      {result.isEmpty ? (
        // 긍정적 빈 상태 — "0"을 결핍이 아닌 안심 신호로.
        <div data-testid="dash-mytasks-empty" className="py-3 text-center">
          <div className="text-2xl text-ai-accent">✓</div>
          <div className="mt-1 text-sm font-medium">지금 손댈 일이 없어요</div>
          <div className="mt-0.5 text-xs text-muted-foreground">담당한 작업을 모두 위임했거나 끝냈어요</div>
          {result.watchedToday > 0 && (
            <Link
              to="/me/tasks/watched"
              className="mt-3 inline-block rounded px-2 py-1 text-xs text-ai-accent hover:underline"
            >
              워치 {result.watchedTotal}건 중 오늘 {result.watchedToday}건 변동 →
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-0.5">
            {result.rows.map(({ issue, bucket }) => (
              <li key={issue.id}>
                <Link
                  to={`/projects/${issue.projectKey}/issues/${issue.number}`}
                  aria-label={`이슈 열기: ${issue.title}`}
                  className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span aria-hidden className="w-4 shrink-0 text-center text-xs">
                    {BUCKET_ICON[bucket]}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {issue.projectKey}-{issue.number}
                  </span>
                  <span className="flex-1 truncate">{issue.title}</span>
                  {meta(bucket, issue.dueDate, issue.updatedAt)}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/me/tasks/assigned" className="mt-2 inline-block px-1 py-1 text-xs text-ai-accent hover:underline">
            전체 보기 →
          </Link>
        </>
      )}
    </div>
  )
}
