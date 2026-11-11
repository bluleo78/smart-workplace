// 「내 작업 · 개요」 탭(WP-1484) — 어제/오늘, 숫자 넷, 끝낸 이슈 추이 + 기한 준수, 앞으로 할 일, 끝낸 일을 한 화면에.
// 숫자는 서버(지표 모듈)가 계산한 값을 그대로 그린다. 나만 볼 수 있다 — API 가 호출자 본인 것만 준다.
// 업무 프로파일(WP-1485)·「일일 보고 보기」(WP-1486)는 이 이슈 범위 밖이라 자리를 두지 않는다.
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { LoadErrorState } from '@/components/LoadErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useMeOverview } from '@/hooks/queries/useMeOverview'
import { cn } from '@/lib/utils'
import type { MeDaySummary, MeOverviewPeriod, MetricsGranularity, MetricsSummary } from '@/types/meOverview'

import { OverviewCard } from './OverviewCard'
import { DueCard, TrendCard } from './OverviewCharts'
import { ClosedListCard, UpcomingCard } from './OverviewLists'
import { dayLabel, formatDays, formatRate, parsePeriod, PERIOD_OPTIONS, PERIOD_PARAM, periodLabel } from './overviewModel'

/**
 * 탭 줄 오른쪽 — 「나만 볼 수 있어요」 + 기간 고르기. 기간은 URL(?period=)에 둬 공유·새로고침해도 유지되고, 기본(이번 달)은 주소에 적지 않는다.
 * 개요 탭에서만 보인다(MyTasksPage 가 정한다).
 */
export function OverviewPeriodPicker() {
  const [params, setParams] = useSearchParams()
  const period = parsePeriod(params.get(PERIOD_PARAM))
  const choose = (p: MeOverviewPeriod) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (p === 'MONTH') next.delete(PERIOD_PARAM)
        else next.set(PERIOD_PARAM, p)
        return next
      },
      { replace: true },
    )
  return (
    <div className="flex items-center gap-2" data-testid="overview-period">
      <span className="text-xs text-muted-foreground">나만 볼 수 있어요</span>
      <div role="group" aria-label="기간" className="inline-flex rounded-md border border-border p-0.5">
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={period === o.value}
            onClick={() => choose(o.value)}
            className={cn(
              'rounded px-2.5 py-1 text-xs',
              period === o.value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 개요 탭 본문 — 기간은 URL, 추이 칸 단위는 화면 상태(기본 일별). 막대로 고른 칸은 끝낸 일 목록을 그 칸으로 좁힌다. */
export function MyOverviewTab() {
  const [params] = useSearchParams()
  const period = parsePeriod(params.get(PERIOD_PARAM))
  const [granularity, setGranularity] = useState<MetricsGranularity>('DAY')
  // 막대로 고른 칸 — 기간·단위가 바뀌면 칸이 달라지므로 그때 푼다(렌더 중 이전 값 비교).
  const [picked, setPicked] = useState<{ start: string; end: string } | null>(null)
  const [pickedFor, setPickedFor] = useState(`${period}:${granularity}`)
  if (pickedFor !== `${period}:${granularity}`) {
    setPickedFor(`${period}:${granularity}`)
    setPicked(null)
  }
  const listRef = useRef<HTMLDivElement>(null)
  const query = useMeOverview(period, granularity)

  if (query.isError && !query.data)
    return (
      <LoadErrorState
        variant="inline"
        title="개요를 불러오지 못했습니다"
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
        testId="overview-error"
      />
    )
  if (!query.data)
    return (
      <div aria-busy="true" aria-label="불러오는 중" className="space-y-4" data-testid="overview-loading">
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-56 w-full" />
      </div>
    )

  const data = query.data
  const label = periodLabel(data.period)
  const pickBucket = (range: { start: string; end: string }) => {
    setPicked(range)
    // 아래 끝낸 일 목록으로 — jsdom 등 scrollIntoView 가 없는 환경에서는 건너뛴다.
    listRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-4" data-testid="overview">
      <DaySection day={data.day} />
      <StatCards current={data.current} previous={data.previous} label={label} />
      <div className="grid gap-4 lg:grid-cols-12">
        <TrendCard
          className="lg:col-span-8"
          data={data}
          label={label}
          granularity={granularity}
          onGranularity={setGranularity}
          picked={picked}
          onPick={pickBucket}
        />
        <DueCard className="lg:col-span-4" data={data} label={label} />
      </div>
      <UpcomingCard upcoming={data.upcoming} today={data.day.today} />
      <div ref={listRef} className="scroll-mt-4">
        <ClosedListCard data={data} label={label} picked={picked} onClearPick={() => setPicked(null)} />
      </div>
    </div>
  )
}

/** 어제 한 일 / 오늘 할 일(전체 폭 두 칸, 좁은 폭은 위아래로). 기간과 무관. */
function DaySection({ day }: { day: MeDaySummary }) {
  return (
    <OverviewCard testId="overview-day" className="grid gap-4 md:grid-cols-2 md:divide-x md:divide-border">
      <div className="space-y-2 md:pr-4" data-testid="overview-yesterday">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          어제 한 일 <span className="text-xs font-normal text-muted-foreground">{dayLabel(day.yesterday)}</span>
        </h2>
        <DayRow count={day.yesterdayCompleted} label="건 끝냄" meta={`그중 AI와 함께 ${day.yesterdayCompletedWithAi} · 기한 내 ${day.yesterdayCompletedOnTime}`} />
        <DayRow count={day.yesterdayCreated} label="건 새로 만듦" />
        {day.yesterdayCompleted === 0 && day.yesterdayCreated === 0 && (
          <p className="text-xs text-muted-foreground">어제 끝내거나 만든 이슈가 없어요</p>
        )}
      </div>
      <div className="space-y-2 md:pl-4" data-testid="overview-today">
        <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
          <span className="flex items-baseline gap-2">
            오늘 할 일 <span className="text-xs font-normal text-muted-foreground">{dayLabel(day.today)}</span>
          </span>
          <Link to="/me/tasks/assigned" className="text-xs font-medium text-primary hover:underline">
            할당 탭에서 보기
          </Link>
        </h2>
        <DayRow
          count={day.overdue}
          label="건 기한 지남"
          danger={day.overdue > 0}
          meta={day.oldestOverdueDays != null ? `가장 오래된 것 ${day.oldestOverdueDays}일` : undefined}
        />
        <DayRow count={day.dueToday} label="건 오늘 마감" />
        <DayRow count={day.waiting} label="건 나를 기다림" meta="AI 답변 필요" />
      </div>
    </OverviewCard>
  )
}

/** 어제/오늘 한 줄 — 「3 건 기한 지남 … 가장 오래된 것 6일」. */
function DayRow({ count, label, meta, danger }: { count: number; label: string; meta?: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span>
        <span className={cn('font-semibold tabular-nums', danger && 'text-destructive')}>{count}</span> {label}
      </span>
      {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
    </div>
  )
}

/** 숫자 넷 — 끝낸 이슈 / 기한 내·기한 초과 / 평균 소요 / 새로 만듦. 비교는 같은 길이의 지난 기간(「지난 기간」). 좁은 폭은 2×2. */
function StatCards({ current, previous, label }: { current: MetricsSummary; previous: MetricsSummary; label: string }) {
  const withDue = current.onTime + current.overdue
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="overview-stats">
      <StatCard
        testId="stat-completed"
        title={`끝낸 이슈 · ${label}`}
        value={<span>{current.completed}</span>}
        meta={`지난 기간 ${previous.completed} · 그중 AI와 함께 ${current.completedWithAi}`}
      />
      <StatCard
        testId="stat-due"
        title="기한 내 · 기한 초과"
        value={
          <span>
            {current.onTime}
            <span className="mx-1 text-base text-muted-foreground">/</span>
            <span className={cn(current.overdue > 0 && 'text-warning-text')}>{current.overdue}</span>
          </span>
        }
        meta={`마감 있는 ${withDue}건 · 준수율 ${formatRate(current.onTimeRate)}`}
      />
      <StatCard
        testId="stat-lead"
        title="평균 소요"
        value={<span>{formatDays(current.leadTimeDaysAvg)}</span>}
        meta={`지난 기간 ${formatDays(previous.leadTimeDaysAvg)} · 만든 날부터 완료까지`}
      />
      <StatCard
        testId="stat-created"
        title={`새로 만듦 · ${label}`}
        value={<span>{current.created}</span>}
        meta={`지난 기간 ${previous.created}`}
      />
    </div>
  )
}

function StatCard({ title, value, meta, testId }: { title: string; value: React.ReactNode; meta: string; testId: string }) {
  return (
    <OverviewCard testId={testId} className="space-y-1">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{meta}</p>
    </OverviewCard>
  )
}
