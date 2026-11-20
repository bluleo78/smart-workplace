// 차트 카드 틀(WP-1822) — 제목·단위·범례·동작이 있는 머리와 본문, 불러오는 중·비어 있음·실패 상태를 한 벌로 그린다.
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { MetricCard } from './MetricCard'

/** 빈 상태 표시 — ChartCard 와 지연 차트 껍데기가 같은 문구·모양을 쓴다. 나머지 props 는 요소에 그대로 전달한다 */
export function ChartEmptyState({
  label = '데이터 없음',
  className,
  ...rest
}: { label?: string } & Omit<React.ComponentProps<'p'>, 'children'>) {
  return (
    <p className={cn('py-8 text-center text-sm text-muted-foreground', className)} {...rest}>
      {label}
    </p>
  )
}

/** 실패 표시 — ChartCard 와 지연 차트 껍데기(chunk 로드 실패)가 같은 문구를 쓴다 */
export function ChartErrorState({ onRetry, hint }: { onRetry?: () => void; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
      <p>불러오지 못함</p>
      {/* 보조 안내(예: 다시 시도도 실패하면 새로고침 안내) — 고정 문구 「불러오지 못함」 아래 작게 둔다 */}
      {hint && <p className="text-xs">{hint}</p>}
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  )
}

export type ChartCardState = 'loading' | 'empty' | 'error'

/** state 가 있으면 본문 대신 상태 표시, 없으면 children. error 에 onRetry 가 있으면 「다시 시도」 단추. */
export function ChartCard({
  title,
  unit,
  legend,
  actions,
  state,
  onRetry,
  emptyLabel = '데이터 없음',
  children,
}: {
  title: string
  unit?: string
  legend?: ReactNode
  actions?: ReactNode
  state?: ChartCardState
  onRetry?: () => void
  emptyLabel?: string
  children?: ReactNode
}) {
  /** 상태에 따라 본문을 고른다 — 상태가 없으면 범례 + children */
  function renderBody() {
    if (state === 'loading') return <Skeleton className="h-40 w-full" data-testid="chart-card-loading" />
    if (state === 'empty') return <ChartEmptyState label={emptyLabel} />
    if (state === 'error') return <ChartErrorState onRetry={onRetry} />
    return (
      <>
        {legend && <div className="mb-2">{legend}</div>}
        {children}
      </>
    )
  }

  return (
    <MetricCard>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
        </div>
        {actions}
      </header>
      {renderBody()}
    </MetricCard>
  )
}
