// 개요 탭 차트(WP-1484) — 완료 추이(막대) + 마감 준수(도넛). 차트 라이브러리가 저장소에 없어 div 막대·SVG 도넛으로 가볍게 그린다.
// 색은 토큰만 — 완료 primary, 그중 늦게 완료 warning, 제때 완료 success, 마감 없음 muted(DS 01).
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import type { MeOverviewResponse, MetricsBucket, MetricsGranularity } from '@/types/meOverview'

import { CompareHint, OverviewCard } from './OverviewCard'
import { bucketLabel, bucketTick, closedListHref, dailyAverage, daysBetween, formatDays, formatRate, GRANULARITY_OPTIONS } from './overviewModel'

/** 막대 칸의 완료 줄 — 「완료 3건 (늦게 2건)」. 늦게 완료는 완료의 일부라 괄호로 묶고, 0건이면 괄호를 뺀다. */
function bucketCompleted(b: MetricsBucket): string {
  return b.overdue > 0 ? `완료 ${b.completed}건 (늦게 ${b.overdue}건)` : `완료 ${b.completed}건`
}

/** 막대 칸 하나의 설명 — 툴팁과 aria-label 이 같은 내용을 쓴다(스크린리더·키보드 사용자도 그 칸 숫자를 듣게). */
function bucketSummary(b: MetricsBucket, g: MetricsGranularity): string {
  return `${bucketLabel(b, g)} · ${bucketCompleted(b)} · 새로 만든 이슈 ${b.created}건`
}

/**
 * 완료 추이 — 막대 = 완료, 아래쪽 겹친 색 = 그중 늦게 완료. 일이 없는 칸은 바닥 얇은 선.
 * 막대에 올리거나 초점을 주면 그 칸의 완료·늦게·새로 만든 이슈, 누르면 할당 탭 완료 목록이 그 칸의 기간으로 열린다.
 * 칸 경계는 서버가 기간 안으로 잘라 주므로(기간 첫 주·첫 달) 그대로 완료일 기간으로 건다.
 */
export function TrendCard({
  className,
  data,
  granularity,
  onGranularity,
}: {
  className?: string
  data: MeOverviewResponse
  granularity: MetricsGranularity
  onGranularity: (g: MetricsGranularity) => void
}) {
  const buckets = data.buckets
  const max = Math.max(1, ...buckets.map((b) => b.completed))
  const days = daysBetween(data.from, data.to) + 1
  // 축 눈금은 처음·가운데·끝 정도만(칸이 많으면 글자가 겹친다).
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 5))
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="overview-trend">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          완료 추이
          <span className="text-xs font-normal text-muted-foreground">하루 평균 {dailyAverage(data.current.completed, days)}건</span>
        </h2>
        <div role="group" aria-label="막대 단위" className="inline-flex rounded-md border border-border p-0.5">
          {GRANULARITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={granularity === o.value}
              onClick={() => onGranularity(o.value)}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                granularity === o.value ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {data.current.completed === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="overview-trend-empty">
          이 기간에 완료한 이슈가 없어요
        </p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-0.5" data-testid="overview-trend-bars">
            {buckets.map((b) => {
              const summary = bucketSummary(b, granularity)
              return (
                <Link
                  key={b.start}
                  to={closedListHref(b.start, b.end)}
                  aria-label={summary}
                  className="group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {b.completed === 0 ? (
                    <span className="h-px w-full bg-border" />
                  ) : (
                    <span
                      className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-primary opacity-80 group-hover:opacity-100"
                      style={{ height: `${(b.completed / max) * 100}%` }}
                    >
                      {b.overdue > 0 && <span className="w-full bg-warning" style={{ height: `${(b.overdue / b.completed) * 100}%` }} />}
                    </span>
                  )}
                  {/* 툴팁 — 올리거나 초점을 주면 보인다. 같은 문구가 aria-label 에도 있다. */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-left text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block"
                  >
                    <span className="block font-medium">{bucketLabel(b, granularity)}</span>
                    <span className="block">{bucketCompleted(b)}</span>
                    <span className="block">새로 만든 이슈 {b.created}건</span>
                  </span>
                </Link>
              )
            })}
          </div>
          <div className="flex gap-0.5 text-xs text-muted-foreground" aria-hidden>
            {buckets.map((b, i) => (
              <span key={b.start} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">
                {i % tickEvery === 0 ? bucketTick(b, granularity) : ''}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-primary" /> 완료
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-warning" /> 그중 늦게 완료
              </span>
            </span>
            <span>막대를 눌러 그 기간에 완료한 이슈 보기</span>
          </div>
        </>
      )}
    </OverviewCard>
  )
}

/** 도넛 — 제때 완료(success)·늦게 완료(warning) 비율. 마감 없음은 준수율 분모가 아니라 도넛에 넣지 않는다. */
function Donut({ onTime, overdue, rate }: { onTime: number; overdue: number; rate: number | null }) {
  const total = onTime + overdue
  const r = 15.9155 // 둘레 100 — dasharray 를 백분율로 바로 쓴다.
  const onTimePct = total === 0 ? 0 : (onTime / total) * 100
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="4" className="stroke-muted" />
        {total > 0 && (
          <>
            <circle cx="18" cy="18" r={r} fill="none" strokeWidth="4" className="stroke-warning" strokeDasharray="100 0" />
            <circle cx="18" cy="18" r={r} fill="none" strokeWidth="4" className="stroke-success" strokeDasharray={`${onTimePct} ${100 - onTimePct}`} />
          </>
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums" data-testid="overview-due-rate">
        {formatRate(rate)}
      </span>
    </div>
  )
}

/**
 * 마감 준수 — 도넛(준수율), 제때 완료·늦게 완료·마감 없음 건수, 늦은 건 평균·직전 같은 기간 준수율, 가장 늦게 완료한 이슈 상위 2건.
 * 완료가 없으면 안내, 완료는 있는데 모두 마감 없음이면 「—」만 덩그러니 두지 않고 그 사실을 알린다.
 */
export function DueCard({ className, data }: { className?: string; data: MeOverviewResponse }) {
  const c = data.current
  const withDue = c.onTime + c.overdue
  // 가장 늦게 완료한 이슈는 서버가 기간 전체에서 고른다.
  const late = data.lateTop
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="overview-due">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        마감 준수 <span className="text-xs font-normal text-muted-foreground">마감 있던 {withDue}건</span>
      </h2>
      {c.completed === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="overview-due-empty">
          이슈를 완료하면 마감 준수율을 보여 드려요
        </p>
      ) : withDue === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="overview-due-nodue">
          마감이 있던 이슈가 없어요
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Donut onTime={c.onTime} overdue={c.overdue} rate={c.onTimeRate} />
            <dl className="flex-1 space-y-1.5 text-sm">
              <LegendRow dot="bg-success" label="제때 완료" value={c.onTime} />
              <LegendRow dot="bg-warning" label="늦게 완료" value={c.overdue} />
              <LegendRow dot="bg-muted" label="마감 없음" value={c.noDue} />
            </dl>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground" data-testid="overview-due-meta">
            {/* 늦은 건이 없으면 「늦은 0건은 평균 — 늦었어요」 대신 사실만 말한다. */}
            <span>{c.overdue > 0 ? `늦은 ${c.overdue}건은 평균 ${formatDays(c.overdueLateDaysAvg)} 늦었어요 ·` : '늦게 완료한 이슈가 없어요 ·'}</span>
            <CompareHint from={data.previousFrom} to={data.previousTo} value={formatRate(data.previous.onTimeRate)} testId="overview-due-compare" />
          </div>
          {late.length > 0 && (
            <div className="space-y-1">
              <p className="px-1 text-xs text-muted-foreground">가장 늦게 완료한 이슈</p>
              <ul className="space-y-1" data-testid="overview-late-top">
                {late.map((i) => (
                  <li key={i.issueId}>
                    <Link
                      to={`/projects/${i.projectKey}/issues/${i.number}`}
                      className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                    >
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {i.projectKey}-{i.number}
                      </span>
                      <span className="flex-1 truncate">{i.title}</span>
                      <span className="shrink-0 text-xs font-medium text-warning-text">{i.lateDays}일 늦음</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </OverviewCard>
  )
}

function LegendRow({ dot, label, value }: { dot: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <span className={cn('h-2 w-2 rounded-full', dot)} /> {label}
      </dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
