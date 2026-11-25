import { CheckCircle2 } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { useMyIssues, useWatchedIssues } from '@/hooks/queries/useHomeQueries'
import { useMeToday } from '@/hooks/queries/useMeOverview'
import { formatRelativeTime } from '@/lib/formatters'
import { buildMyTaskRows, dueLabel, type MyTaskBucket, type MyTaskRow } from '@/lib/myTasks'
import { showsLoadError } from '@/lib/queryFailure'
import type { IssueSearchResponse } from '@/types/issue'

import { WidgetError } from '../WidgetError'
import { WidgetEmptyState } from './WidgetEmptyState'

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

// WP-2076 · 리뷰 후속: 항목 수별 본문 최소 높이 — 격리 스택(work-loop) 실측 자연 높이(1440·390 동일).
// 로딩 스켈레톤·데이터·오류가 이 표를 공유해야 데이터 도착 전후 높이가 같다(→ CLS).
// 3 은 3행 실측 200 이지만 빈 상태 실측 220 보다 작아 로딩(200)→빈 상태(220) 전환에서 20px 가 밀린다 —
// 표는 max(해당 count 실측, 빈 상태 220) 을 쓴다(5·10 은 실측 그대로 260·470).
// 5 가 기본값이다(위젯 설정은 3·5·10 — backend 화이트리스트와 같은 값).
const BODY_MIN_HEIGHT_PX: Record<number, number> = { 3: 220, 5: 260, 10: 470 }
/** 본문 최소 높이(px) — 표에 없는 항목 수는 기본값 5 로 본다(설정 화이트리스트 밖 값). */
function bodyMinHeightPx(count: number): number {
  return BODY_MIN_HEIGHT_PX[count] ?? BODY_MIN_HEIGHT_PX[5]
}

/** 내 작업 위젯 본문 — 나를 기다리는 열린 루프를 위급도 그룹 리스트로, 비면 긍정적 빈 상태로 렌더. */
export default function MyTasksBody({
  count: limit = 5,
  previewData,
}: {
  count?: number
  previewData?: { assigned: IssueSearchResponse; watched: IssueSearchResponse }
}) {
  // WP-1899: 행 설명 id 접두 — 훅 규칙상 early return 전에 둔다.
  const base = useId()
  const assigned = useMyIssues({ assignee: 'me', size: 50 }, { enabled: !previewData })
  const watched = useWatchedIssues({ enabled: !previewData })
  // 어제/오늘 한 줄(WP-1484) — 개요 탭과 같은 요약. 미리보기(카탈로그)에선 부르지 않고, 실패하면 이 줄만 숨긴다(목록은 그대로).
  const today = useMeToday({ enabled: !previewData })
  const loading = !previewData && (assigned.isLoading || watched.isLoading)
  // 둘 중 하나라도 실패하면 분류가 거짓이 되므로 전체를 에러 처리(#205).
  const isError = !previewData && (showsLoadError(assigned) || showsLoadError(watched))
  // 본문 최소 높이 — 로딩·오류·데이터 세 분기가 같은 값을 쓴다(early return 전에 계산).
  const minHeight = bodyMinHeightPx(limit)

  // 실패 안내는 로딩보다 먼저 본다 — 다시 부르는 동안에도 안내를 그대로 둬야 다시 시도의 초점이 남는다(WP-881).
  if (isError)
    return (
      <div data-testid="dash-mytasks-body" style={{ minHeight }}>
        <WidgetError
          onRetry={() => {
            assigned.refetch()
            watched.refetch()
          }}
          retrying={assigned.isFetching || watched.isFetching}
          testId="dash-mytasks-error"
        />
      </div>
    )
  // I3(a11y): 로딩 영역에 aria-busy + 라벨. role="status" — role 없는 div 의 aria-label 은 AT 가 무시할 수 있어 라이브 리전임을 role 로 밝힌다(WP-2076 리뷰).
  // flex + minHeight 로 스켈레톤이 데이터 본문과 같은 높이를 채운다(로딩/데이터 높이 동일 → CLS).
  if (loading)
    return (
      <div role="status" aria-busy="true" aria-label="불러오는 중" className="flex" style={{ minHeight }}>
        <Skeleton className="w-full" />
      </div>
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
  // metaId: 행 Link 의 aria-describedby 가 이 span 을 가리키도록 단다(WP-1899).
  function meta(bucket: MyTaskBucket, dueDate: string | null, updatedAt: string, metaId: string) {
    if (bucket === 'due' && dueDate)
      return (
        <span id={metaId} className="shrink-0 text-xs font-semibold text-destructive">
          {dueLabel(dueDate, now)}
        </span>
      )
    if (bucket === 'watched')
      return (
        <span id={metaId} className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(updatedAt)}
        </span>
      )
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
    // WP-2076: 로딩 스켈레톤과 같은 minHeight(항목 수별 실측 표) — 도착 전후 본문 높이가 같아야 아래 카드가 밀리지 않는다(CLS).
    <div data-testid="dash-mytasks" style={{ minHeight }}>
      {today.data && (
        // 누르면 내 작업 개요 탭 — 어제 한 일·오늘 할 일을 자세히 본다.
        <Link
          to="/me/tasks/overview"
          className="mb-1 block text-xs text-muted-foreground hover:text-ai-accent hover:underline"
          data-testid="dash-mytasks-today"
        >
          {/* 개요 탭과 같은 말(완료·마감 지남·답변 필요) — 아래 「n건이 나를 기다림」(맡은 처리할 이슈)과 겹치지 않게 「나를 기다림」을 쓰지 않는다. */}
          어제 완료 <span className="font-medium text-foreground">{today.data.yesterdayCompleted}</span> · 마감 지남{' '}
          <span className={today.data.overdue > 0 ? 'font-medium text-destructive' : 'font-medium text-foreground'}>{today.data.overdue}</span> · 답변
          필요 <span className="font-medium text-foreground">{today.data.waiting}</span>
        </Link>
      )}
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
        // 긍정적 빈 상태 — "0"을 결핍이 아닌 안심 신호로(#653: 공용 WidgetEmptyState 사용).
        <WidgetEmptyState
          icon={CheckCircle2}
          // 긍정 빈 상태는 '비었다'가 아니라 '다 끝냈다'를 뜻하므로 체크 아이콘은 muted 가 아닌 primary 로 둔다
          // (디자인 시스템 06 §B 예외 — 메일 회신필요 0건 체크와 동일).
          tone="positive"
          title="지금 손댈 일이 없어요"
          description="담당한 작업을 모두 위임했거나 끝냈어요"
          // 빈 상태는 늘 다음 행동을 둔다(WP-1853). 오늘 구독 변동이 있으면 그 링크, 없으면 새 이슈 —
          // 빠른 액션과 같은 진입이며, 이슈 생성은 프로젝트 범위라 /projects 로 보낸다.
          cta={
            result.watchedToday > 0
              ? { label: `구독 중 오늘 ${result.watchedToday}건 변동`, to: '/me/tasks/watched' }
              : { label: '새 이슈', to: '/projects' }
          }
          testId="dash-mytasks-empty"
        />
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
                  {group.rows.map(({ issue, bucket }) => {
                    // WP-1899: 이름(aria-label)은 제목만 두고, 이슈 키·마감/변동 시각은 aria-describedby 로 설명에 잇는다.
                    // meta 가 없는 행은 그 id 를 잇지 않는다(그린 요소와 같은 조건).
                    const keyId = `${base}-${issue.id}-key`
                    const metaId = `${base}-${issue.id}-meta`
                    const metaNode = meta(bucket, issue.dueDate, issue.updatedAt, metaId)
                    return (
                      <li key={issue.id}>
                        <Link
                          to={`/projects/${issue.projectKey}/issues/${issue.number}`}
                          aria-label={`이슈 열기: ${issue.title}`}
                          aria-describedby={[keyId, metaNode && metaId].filter(Boolean).join(' ')}
                          className="flex min-h-6 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <span id={keyId} className="shrink-0 text-xs text-muted-foreground">
                            {issue.projectKey}-{issue.number}
                          </span>
                          <span className="flex-1 truncate">{issue.title}</span>
                          {metaNode}
                        </Link>
                      </li>
                    )
                  })}
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
