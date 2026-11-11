// 개요 탭 차트(WP-1484) — 끝낸 이슈 추이(막대) + 기한 준수(도넛). 차트 라이브러리가 저장소에 없어 div 막대·SVG 도넛으로 가볍게 그린다.
// 색은 토큰만 — 끝낸 이슈 primary, 그중 기한 초과 warning, 기한 내 success, 마감 없음 muted(DS 01).
import { Link } from 'react-router-dom'

import { cn } from '@/lib/utils'
import type { MeOverviewResponse, MetricsBucket, MetricsGranularity } from '@/types/meOverview'

import { OverviewCard } from './OverviewCard'
import { bucketLabel, bucketTick, dailyAverage, daysBetween, formatRate, GRANULARITY_OPTIONS } from './overviewModel'

/** 막대 칸 하나의 설명 — 툴팁과 aria-label 이 같은 문구를 쓴다(스크린리더·키보드 사용자도 그날 숫자를 듣게). */
function bucketSummary(b: MetricsBucket, g: MetricsGranularity): string {
  return `${bucketLabel(b, g)} · 끝냄 ${b.completed} · 새로 만듦 ${b.created} · 기한 초과 ${b.overdue}`
}

/**
 * 끝낸 이슈 추이 — 막대 = 끝낸 이슈, 아래쪽 겹친 색 = 그중 기한 초과. 일이 없는 칸은 바닥 얇은 선.
 * 막대에 올리거나 초점을 주면 그 칸의 끝냄·새로 만듦·기한 초과, 누르면 아래 끝낸 일 목록이 그 칸으로 좁혀진다.
 */
export function TrendCard({
  className,
  data,
  label,
  granularity,
  onGranularity,
  picked,
  onPick,
}: {
  className?: string
  data: MeOverviewResponse
  label: string
  granularity: MetricsGranularity
  onGranularity: (g: MetricsGranularity) => void
  picked: { start: string; end: string } | null
  onPick: (range: { start: string; end: string }) => void
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
          끝낸 이슈 추이
          <span className="text-xs font-normal text-muted-foreground">
            {label} · 하루 평균 {dailyAverage(data.current.completed, days)}건
          </span>
        </h2>
        <div role="group" aria-label="추이 단위" className="inline-flex rounded-md border border-border p-0.5">
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
          이 기간에 끝낸 이슈가 없어요
        </p>
      ) : (
        <>
          <div className="flex h-40 items-end gap-0.5" data-testid="overview-trend-bars">
            {buckets.map((b) => {
              const isPicked = picked?.start === b.start && picked?.end === b.end
              const summary = bucketSummary(b, granularity)
              return (
                <button
                  key={b.start}
                  type="button"
                  aria-label={summary}
                  aria-pressed={isPicked}
                  onClick={() => onPick({ start: b.start, end: b.end })}
                  className={cn(
                    'group relative flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    isPicked && 'bg-muted',
                  )}
                >
                  {b.completed === 0 ? (
                    <span className="h-px w-full bg-border" />
                  ) : (
                    <span
                      className={cn('flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-primary', isPicked ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')}
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
                    <span className="block">끝냄 {b.completed}</span>
                    <span className="block">새로 만듦 {b.created}</span>
                    <span className="block">기한 초과 {b.overdue}</span>
                  </span>
                </button>
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
                <span className="h-2 w-2 rounded-sm bg-primary" /> 끝낸 이슈
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-warning" /> 그중 기한 초과
              </span>
            </span>
            <span>막대를 누르면 그날 한 일</span>
          </div>
        </>
      )}
    </OverviewCard>
  )
}

/** 도넛 — 기한 내(success)·기한 초과(warning) 비율. 마감 없음은 준수율 분모가 아니라 도넛에 넣지 않는다. */
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

/** 기한 준수 — 도넛(준수율), 기한 내·기한 초과·마감 없음 건수, 늦은 n건·평균 늦음·지난 기간 준수율, 늦은 이슈 상위 2건. */
export function DueCard({ className, data, label }: { className?: string; data: MeOverviewResponse; label: string }) {
  const c = data.current
  const withDue = c.onTime + c.overdue
  // 늦은 이슈 상위는 서버가 기간 전체에서 고른다 — 끝낸 일 목록은 최근 50건으로 잘려 그 안에서 고르면 오래 늦은 건이 빠진다.
  const late = data.lateTop
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="overview-due">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        기한 준수 <span className="text-xs font-normal text-muted-foreground">{label} · 마감 있는 {withDue}건</span>
      </h2>
      {c.completed === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="overview-due-empty">
          끝낸 이슈가 생기면 기한 준수를 보여 드려요
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Donut onTime={c.onTime} overdue={c.overdue} rate={c.onTimeRate} />
            <dl className="flex-1 space-y-1.5 text-sm">
              <LegendRow dot="bg-success" label="기한 내" value={c.onTime} />
              <LegendRow dot="bg-warning" label="기한 초과" value={c.overdue} />
              <LegendRow dot="bg-muted" label="마감 없음" value={c.noDue} />
            </dl>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="overview-due-meta">
            늦은 {c.overdue}건 · 평균 {c.overdueLateDaysAvg == null ? '—' : `${Math.round(c.overdueLateDaysAvg * 10) / 10}일`} 늦음 · 지난 기간
            준수율 {formatRate(data.previous.onTimeRate)}
          </p>
          {late.length > 0 && (
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
                    <span className="shrink-0 text-xs font-medium text-warning-text">{i.lateDays}일</span>
                  </Link>
                </li>
              ))}
            </ul>
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
