// 「내 작업 · 개요」 탭(WP-1484) — 어제/오늘, 숫자 넷, 완료 추이 + 마감 준수, 맡은 이슈를 한 화면에. 앞으로 할 일(맡은 이슈)로 끝난다.
// 완료한 이슈 목록(옛 「끝낸 일」)은 두지 않는다 — 「완료한 이슈」 카드와 추이 막대가 할당 탭 완료 목록(완료일 기간)으로 보낸다(문구 감사 결정).
// 숫자는 서버(지표 모듈)가 계산한 값을 그대로 그린다. 나만 볼 수 있다 — API 가 호출자 본인 것만 준다.
// 업무 프로파일(WP-1485)은 추이/마감 아래·맡은 이슈 위 전체 폭 카드로 둔다(자기 조회라 실패해도 개요 전체를 막지 않는다). 「일일 보고 보기」(WP-1486)는 아직 자리를 두지 않는다.
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { LoadErrorState } from '@/components/LoadErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useMeOverview } from '@/hooks/queries/useMeOverview'
import { cn } from '@/lib/utils'
import type { MeDaySummary, MeOverviewPeriod, MeOverviewResponse, MetricsGranularity } from '@/types/meOverview'

import { CompareHint, OverviewCard } from './OverviewCard'
import { DueCard, TrendCard } from './OverviewCharts'
import { UpcomingCard } from './OverviewLists'
import { closedListHref, dayLabel, formatDays, formatRate, parsePeriod, PERIOD_OPTIONS, PERIOD_PARAM } from './overviewModel'
import { WorkProfileCard } from './WorkProfileCard'

/**
 * 탭 줄 오른쪽 — 「나에게만 보여요」(자물쇠) + 기간 고르기. 기간은 URL(?period=)에 둬 공유·새로고침해도 유지되고, 기본(이번 달)은 주소에 적지 않는다.
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
      {/* 자물쇠로 기간 버튼과 다른 정보(공개 범위)임을 한눈에 보인다. */}
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden />
        나에게만 보여요
      </span>
      <div role="group" aria-label="조회 기간" className="inline-flex rounded-md border border-border p-0.5">
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

/** 개요 탭 본문 — 기간은 URL, 추이 칸 단위는 화면 상태(기본 일별). */
export function MyOverviewTab() {
  const [params] = useSearchParams()
  const period = parsePeriod(params.get(PERIOD_PARAM))
  const [granularity, setGranularity] = useState<MetricsGranularity>('DAY')
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
  return (
    <div className="space-y-4" data-testid="overview">
      <DaySection day={data.day} />
      <StatCards data={data} />
      <div className="grid gap-4 lg:grid-cols-12">
        <TrendCard className="lg:col-span-8" data={data} granularity={granularity} onGranularity={setGranularity} />
        <DueCard className="lg:col-span-4" data={data} />
      </div>
      <WorkProfileCard period={period} />
      <UpcomingCard upcoming={data.upcoming} today={data.day.today} />
    </div>
  )
}

/** 어제 / 오늘(전체 폭 두 칸, 좁은 폭은 위아래로). 기간과 무관. 줄은 「라벨 n건」 모양으로 통일한다. */
function DaySection({ day }: { day: MeDaySummary }) {
  return (
    <OverviewCard testId="overview-day" className="grid gap-4 md:grid-cols-2 md:divide-x md:divide-border">
      <div className="space-y-2 md:pr-4" data-testid="overview-yesterday">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          어제 <span className="text-xs font-normal text-muted-foreground">{dayLabel(day.yesterday)}</span>
        </h2>
        <DayRow
          label="완료"
          count={day.yesterdayCompleted}
          meta={`AI와 함께 ${day.yesterdayCompletedWithAi}건 · 제때 ${day.yesterdayCompletedOnTime}건`}
        />
        <DayRow label="새로 만든 이슈" count={day.yesterdayCreated} />
        {day.yesterdayCompleted === 0 && day.yesterdayCreated === 0 && (
          <p className="text-xs text-muted-foreground">어제 완료하거나 만든 이슈가 없어요</p>
        )}
      </div>
      <div className="space-y-2 md:pl-4" data-testid="overview-today">
        <h2 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
          <span className="flex items-baseline gap-2">
            오늘 <span className="text-xs font-normal text-muted-foreground">{dayLabel(day.today)}</span>
          </span>
          <Link to="/me/tasks/assigned" className="text-xs font-medium text-primary hover:underline">
            할당 탭에서 보기
          </Link>
        </h2>
        <DayRow
          label="마감 지남"
          count={day.overdue}
          danger={day.overdue > 0}
          meta={day.oldestOverdueDays != null ? `최장 ${day.oldestOverdueDays}일 지남` : undefined}
        />
        <DayRow label="오늘 마감" count={day.dueToday} />
        <DayRow label="답변 필요" count={day.waiting} meta="AI가 질문함" />
      </div>
    </OverviewCard>
  )
}

/** 어제/오늘 한 줄 — 「마감 지남 3건 … 최장 6일 지남」. 라벨을 앞, 숫자를 뒤에 둔다(음슴체 「3 건 끝냄」을 쓰지 않는다). */
function DayRow({ label, count, meta, danger }: { label: string; count: number; meta?: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span>
        {label} <span className={cn('font-semibold tabular-nums', danger && 'text-destructive')}>{count}건</span>
      </span>
      {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
    </div>
  )
}

/**
 * 숫자 넷 — 완료한 이슈 / 제때·늦게 / 평균 처리 기간 / 새로 만든 이슈. 비교는 같은 길이의 바로 앞 기간(「직전 같은 기간」, 툴팁에 실제 날짜).
 * 기간은 바로 위 기간 고르기가 말해 주므로 제목에 되풀이하지 않는다. 「완료한 이슈」는 누르면 할당 탭 완료 목록(이 기간)으로 간다. 좁은 폭은 2×2.
 */
function StatCards({ data }: { data: MeOverviewResponse }) {
  const { current, previous, previousFrom, previousTo } = data
  const withDue = current.onTime + current.overdue
  const compare = (value: string, testId: string) => <CompareHint from={previousFrom} to={previousTo} value={value} testId={testId} />
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="overview-stats">
      <StatCard
        testId="stat-completed"
        title="완료한 이슈"
        href={closedListHref(data.from, data.to)}
        value={<span>{current.completed}</span>}
        meta={
          <>
            <span>AI와 함께 {current.completedWithAi}건 ·</span>
            {compare(`${previous.completed}건`, 'stat-completed-compare')}
          </>
        }
      />
      <StatCard
        testId="stat-due"
        title="제때 / 늦게"
        value={
          <span>
            {current.onTime}
            <span className="mx-1 text-base text-muted-foreground">/</span>
            <span className={cn(current.overdue > 0 && 'text-warning-text')}>{current.overdue}</span>
          </span>
        }
        // 마감 있던 이슈가 없으면 「0건 중 — 제때」 대신 마감 준수 카드와 같은 안내.
        meta={withDue > 0 ? `마감 있던 ${withDue}건 중 ${formatRate(current.onTimeRate)} 제때` : '마감이 있던 이슈가 없어요'}
      />
      <StatCard
        testId="stat-lead"
        title="평균 처리 기간"
        value={<span>{formatDays(current.leadTimeDaysAvg)}</span>}
        meta={
          <>
            <span>만든 날부터 완료까지 ·</span>
            {compare(formatDays(previous.leadTimeDaysAvg), 'stat-lead-compare')}
          </>
        }
      />
      <StatCard
        testId="stat-created"
        title="새로 만든 이슈"
        value={<span>{current.created}</span>}
        meta={compare(`${previous.created}건`, 'stat-created-compare')}
      />
    </div>
  )
}

/**
 * 숫자 카드 하나. href 가 있으면 제목·숫자가 링크다 — 아랫줄(비교 툴팁)은 링크 밖에 둔다(터치에선 툴팁이 단추라 링크 안 단추가 되지 않게).
 */
function StatCard({
  title,
  value,
  meta,
  testId,
  href,
}: {
  title: string
  value: React.ReactNode
  meta: React.ReactNode
  testId: string
  href?: string
}) {
  const head = (
    <>
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </>
  )
  return (
    <OverviewCard testId={testId} className="space-y-1">
      {href ? (
        <Link to={href} className="-m-1 block space-y-1 rounded p-1 hover:bg-muted/50" data-testid={`${testId}-link`}>
          {head}
        </Link>
      ) : (
        head
      )}
      <div className="flex flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground">{meta}</div>
    </OverviewCard>
  )
}
