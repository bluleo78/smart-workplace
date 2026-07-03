import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries'
import { formatRelativeTime } from '@/lib/formatters'
import { buildMyTaskRows, dueLabel, type MyTaskBucket, type MyTaskRow } from '@/lib/myTasks'
import type { IssueSearchResponse } from '@/types/issue'

import { WidgetError } from '../WidgetError'

// 버킷별 그룹 헤더 라벨 — 위급도 범주를 한 줄로 표시(행은 그룹 아래 정렬).
const BUCKET_LABEL: Record<MyTaskBucket, string> = {
  due: '마감 임박',
  blocked: '막힘',
  in_progress: '진행 중',
  todo: '미시작',
  ai_followup: 'AI 되묻기',
  mention: '멘션·리뷰',
  watched: '구독 최근 변동',
}

/** 내 작업 위젯 본문 — 나를 기다리는 열린 루프를 위급도 그룹 리스트로, 비면 긍정적 빈 상태로 렌더. */
export default function MyTasksBody({
  count: limit = 5,
  previewData,
}: {
  count?: number
  previewData?: { assigned: IssueSearchResponse; watched: IssueSearchResponse }
}) {
  const assigned = useMyIssues({ assignee: 'me', size: 50 }, { enabled: !previewData })
  const watched = useWatchedIssues({ enabled: !previewData })
  const loading = !previewData && (assigned.isLoading || watched.isLoading)
  // 둘 중 하나라도 실패하면 분류가 거짓이 되므로 전체를 에러 처리(#205).
  const isError = !previewData && (assigned.isError || watched.isError)

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
    previewData ? previewData.assigned.items : (assigned.data?.items ?? []),
    previewData ? previewData.watched.items : (watched.data?.items ?? []),
    limit,
    now,
  )

  // due 버킷 필터용 상한 = 오늘+1(YYYY-MM-DD) — buildMyTaskRows 의 임박 기준과 동일.
  const dueToDate = new Date(now)
  dueToDate.setDate(dueToDate.getDate() + 1)
  const dueToParam = `${dueToDate.getFullYear()}-${String(dueToDate.getMonth() + 1).padStart(2, '0')}-${String(dueToDate.getDate()).padStart(2, '0')}`

  // 버킷 → 필터링된 조회 화면 딥링크. ai_followup/mention 은 데이터 소스 미존재라 링크 없음(향후).
  function groupLink(bucket: MyTaskBucket): string | undefined {
    switch (bucket) {
      case 'due':
        return `/me/tasks/assigned?dueTo=${dueToParam}`
      case 'blocked':
        return '/me/tasks/assigned?blocked=true'
      case 'in_progress':
        return '/me/tasks/assigned?status=IN_PROGRESS'
      case 'todo':
        return '/me/tasks/assigned?status=TODO'
      case 'watched':
        return '/me/tasks/watched'
      default:
        return undefined
    }
  }

  // 행별 우측 메타 — 그룹 헤더가 못 담는 "가변" 정보만(마감 D-n, 구독 변동 상대시간).
  function meta(bucket: MyTaskBucket, dueDate: string | null, updatedAt: string) {
    if (bucket === 'due' && dueDate)
      return <span className="shrink-0 text-xs font-semibold text-destructive">{dueLabel(dueDate, now)}</span>
    if (bucket === 'watched')
      return <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(updatedAt)}</span>
    return null
  }

  // rows 는 이미 버킷 순 정렬 — 연속 동일 버킷을 그룹으로 묶는다.
  const groups: { bucket: MyTaskBucket; rows: MyTaskRow[] }[] = []
  for (const row of result.rows) {
    const last = groups[groups.length - 1]
    if (last && last.bucket === row.bucket) last.rows.push(row)
    else groups.push({ bucket: row.bucket, rows: [row] })
  }

  return (
    <div data-testid="dash-mytasks">
      {/* 헤더 부제 — 기다리는 건수(→할당) 또는 구독 총량(→구독). 숫자 자체가 필터 조회로 가는 링크. */}
      <div className="mb-2 text-sm text-muted-foreground">
        {result.isEmpty ? (
          <Link to="/me/tasks/watched" className="hover:underline">
            구독 중 <span className="font-medium text-ai-accent">{result.watchedTotal}건</span>
          </Link>
        ) : (
          <Link to="/me/tasks/assigned" className="hover:underline">
            <span className="font-medium text-ai-accent">{result.waitingCount}건</span>이 나를 기다림
          </Link>
        )}
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
              구독 중 오늘 {result.watchedToday}건 변동 →
            </Link>
          )}
        </div>
      ) : (
        <>
          {groups.map((group) => {
            const to = groupLink(group.bucket)
            const label = BUCKET_LABEL[group.bucket]
            return (
              <div key={group.bucket} className="mb-1.5 last:mb-0">
                {/* 그룹 헤더 — 링크면 해당 범주의 필터링된 조회 화면으로 이동. */}
                <div className="mb-0.5 px-1">
                  {to ? (
                    <Link
                      to={to}
                      className="text-sm font-medium text-muted-foreground hover:text-ai-accent hover:underline"
                    >
                      {label} →
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">{label}</span>
                  )}
                </div>
                <ul className="space-y-0.5">
                  {group.rows.map(({ issue, bucket }) => (
                    <li key={issue.id}>
                      <Link
                        to={`/projects/${issue.projectKey}/issues/${issue.number}`}
                        aria-label={`이슈 열기: ${issue.title}`}
                        className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {issue.projectKey}-{issue.number}
                        </span>
                        <span className="flex-1 truncate">{issue.title}</span>
                        {meta(bucket, issue.dueDate, issue.updatedAt)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
          <Link to="/me/tasks/assigned" className="mt-2 inline-block px-1 py-1 text-xs text-ai-accent hover:underline">
            전체 보기 →
          </Link>
        </>
      )}
    </div>
  )
}
