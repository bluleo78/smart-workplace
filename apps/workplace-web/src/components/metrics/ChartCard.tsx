// 차트 카드 틀(WP-1822) — 제목·단위·범례·동작이 있는 머리와 본문, 불러오는 중·비어 있음·실패 상태를 한 벌로 그린다.
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { MetricCard } from './MetricCard'

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
    if (state === 'empty') return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
    if (state === 'error') {
      return (
        <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
          <p>불러오지 못함</p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              다시 시도
            </Button>
          )}
        </div>
      )
    }
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
