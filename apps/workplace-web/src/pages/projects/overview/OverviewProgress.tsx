// 프로젝트 개요(WP-1478) 「진행 중」 — 날짜가 있는 묶음 하나의 흐름 + 아래 칸 에픽.
// 고르는 순서(서버): 진행 중 사이클 → 출시일이 가장 가까운 미출시 버전 → 둘 다 없으면 프로젝트 전체 8주 열린 이슈 추이.
// 그래프는 차트 라이브러리 없이 SVG 로 직접 그린다 — 범위(회색 선)·완료(파란 선)·지금 속도로 예상(파란 점선)·종료일(세로 점선).
// 사이클·버전·에픽이 하나도 없으면 관리자(사이클을 만들 수 있는 사람)에게만 「사이클 만들기」 안내를 보인다.
import { Link } from 'react-router-dom'

import { issuePath } from '@/lib/appUrl'
import { cn } from '@/lib/utils'
import type { ProjectOverviewProgress } from '@/types/projectOverview'

import { OverviewCard } from '../../me/overview/OverviewCard'
import {
  epicsHref,
  progressChart,
  progressCount,
  progressHeading,
  progressLink,
  projectionText,
  type ProjectionTone,
  slashDay,
} from './overviewModel'
import { BarRow, WidgetHeader } from './OverviewParts'

/** 예상 문구 색 — 토큰만(DS 01). */
const TONE_CLASS: Record<ProjectionTone, string> = {
  success: 'text-success-text',
  warning: 'text-warning-text',
  muted: 'text-muted-foreground',
}

export function OverviewProgress({
  className,
  projectKey,
  today,
  progress,
  canManage,
}: {
  className?: string
  projectKey: string
  today: string
  progress: ProjectOverviewProgress
  canManage: boolean
}) {
  const heading = progressHeading(progress, today)
  const projection = projectionText(progress, today)
  const link = progressLink(projectKey, progress)
  const epics = progress.epics
  // 사이클·버전이 없어 전체 추이를 보이고 에픽도 없을 때 — 진행률을 볼 묶음이 하나도 없다.
  const nothingToTrack = progress.kind === 'TREND' && epics.total === 0
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="project-overview-progress">
      <WidgetHeader title="진행 중" link={{ ...link, testId: 'progress-link' }} />
      <div className="flex items-baseline justify-between gap-2">
        <p className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="truncate font-semibold" data-testid="progress-name">
            {heading.name}
          </span>
          {heading.badge && (
            <span className="shrink-0 rounded border border-border px-1 text-xs text-muted-foreground">{heading.badge}</span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground" data-testid="progress-meta">
            {heading.meta}
          </span>
        </p>
        <span className="shrink-0 text-sm font-medium tabular-nums" data-testid="progress-count">
          {progressCount(progress)}
        </span>
      </div>
      <ProgressChartView progress={progress} label={`${heading.name} 진행 그래프 — ${progressCount(progress)}, ${projection.text}`} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <Legend progress={progress} />
        <span className={cn('font-medium', TONE_CLASS[projection.tone])} data-testid="progress-projection">
          {projection.text}
        </span>
      </div>
      {epics.total > 0 && <EpicSection projectKey={projectKey} epics={epics} />}
      {nothingToTrack && canManage && (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground" data-testid="progress-guide">
          사이클·버전·에픽을 쓰면 여기서 진행률을 볼 수 있어요.{' '}
          <Link to={`/projects/${projectKey}/cycles`} className="font-medium text-primary hover:underline">
            사이클 만들기
          </Link>
        </p>
      )}
    </OverviewCard>
  )
}

/** 그래프 — 가로로 늘어나게(preserveAspectRatio none) 그리고 선 굵기는 늘이지 않는다(non-scaling-stroke). 종료일 글은 HTML 로 얹는다. */
function ProgressChartView({ progress, label }: { progress: ProjectOverviewProgress; label: string }) {
  const c = progressChart(progress)
  // 점이 없으면(시작 전 사이클) 빈 그래프 대신 안내 — 그래프는 시작일부터 그린다.
  if (!c.scope)
    return (
      <p className="flex h-28 items-center justify-center text-xs text-muted-foreground" data-testid="progress-chart-empty">
        시작일부터 그래프를 그려요
      </p>
    )
  const trend = progress.kind === 'TREND'
  const endWord = progress.kind === 'VERSION' ? '출시' : '종료'
  return (
    <div className="relative h-28" data-testid="progress-chart">
      <svg
        viewBox={`0 0 ${c.width} ${c.height}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={label}
      >
        {/* 바닥선 — 0 의 자리. */}
        <line x1="0" x2={c.width} y1={c.height - 4} y2={c.height - 4} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {c.endX != null && (
          <line
            x1={c.endX}
            x2={c.endX}
            y1="0"
            y2={c.height}
            className="stroke-muted-foreground"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            data-testid="progress-end-line"
          />
        )}
        <polyline
          points={c.scope}
          fill="none"
          className={trend ? 'stroke-primary' : 'stroke-muted-foreground'}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          data-testid="progress-scope-line"
        />
        {c.done && (
          <polyline points={c.done} fill="none" className="stroke-primary" strokeWidth="2" vectorEffect="non-scaling-stroke" data-testid="progress-done-line" />
        )}
        {c.projected && (
          <polyline
            points={c.projected}
            fill="none"
            className="stroke-primary"
            strokeWidth="2"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            data-testid="progress-projected-line"
          />
        )}
      </svg>
      {c.endX != null && progress.target?.end && (
        <span
          className="pointer-events-none absolute top-0 -translate-x-1/2 bg-card px-1 text-xs text-muted-foreground"
          style={{ left: `${(c.endX / c.width) * 100}%` }}
          aria-hidden
        >
          {endWord} {slashDay(progress.target.end)}
        </span>
      )}
    </div>
  )
}

/** 범례 — 전체 추이는 「열린 이슈 수」, 사이클·버전은 범위·완료(+ 예상이 있으면 지금 속도로 예상). */
function Legend({ progress }: { progress: ProjectOverviewProgress }) {
  const item = (cls: string, text: string, dashed = false) => (
    <span className="flex items-center gap-1">
      <span className={cn('inline-block w-3 border-t-2', cls, dashed && 'border-dashed')} aria-hidden /> {text}
    </span>
  )
  if (progress.kind === 'TREND') return <span className="flex items-center gap-3 text-muted-foreground">{item('border-primary', '열린 이슈 수')}</span>
  return (
    <span className="flex items-center gap-3 text-muted-foreground">
      {item('border-muted-foreground', '범위')}
      {item('border-primary', '완료')}
      {progress.projectedDate && item('border-primary', '지금 속도로 예상', true)}
    </span>
  )
}

/**
 * 아래 칸 에픽 — 「에픽 · 진행 중 9 / 전체 31」, 최근 움직인 순 4개(자식 완료/전체), 「모두 보기」는 닫히지 않은 에픽 이슈 탭.
 * 에픽 유형 id(이슈 탭 유형 필터 type=id)는 응답이 함께 준다 — 유형 목록을 따로 부르지 않는다.
 */
function EpicSection({ projectKey, epics }: { projectKey: string; epics: ProjectOverviewProgress['epics'] }) {
  return (
    <div className="space-y-1 border-t border-border pt-3" data-testid="progress-epics">
      <WidgetHeader
        title="에픽"
        aside={`진행 중 ${epics.inProgress} / 전체 ${epics.total}`}
        link={{ label: '모두 보기', href: epicsHref(projectKey, epics.epicTypeId), testId: 'progress-epics-all' }}
      />
      <div>
        {epics.items.map((e) => (
          <BarRow
            key={e.issueKey}
            label={e.title}
            value={e.done}
            max={e.total}
            valueText={`${e.done} / ${e.total}`}
            barClass="bg-success"
            href={issuePath(projectKey, e.number)}
            testId={`progress-epic-${e.issueKey}`}
          />
        ))}
      </div>
    </div>
  )
}
