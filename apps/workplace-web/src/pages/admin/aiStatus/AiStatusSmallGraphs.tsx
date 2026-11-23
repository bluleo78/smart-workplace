// AI 현황 개요의 작은 그래프 자리(WP-1824) — 모델이 만든 정의 5개(응답 시간·실패·대기·밀린 건수·동시 처리)를
// 카드로 조립한다. 데스크톱은 2열(sm)·3열(xl), 모바일은 한 열(설계 §5-3 5).
import { useMemo } from 'react'

import type { Series } from '@/api/aiStatus'
import { ChartCard } from '@/components/metrics/ChartCard'
import { StackedBarChart } from '@/components/metrics/StackedBarChart'
import { TrendChart } from '@/components/metrics/TrendChart'
import { useIsMobile } from '@/hooks/useIsMobile'

import type { ChartRow } from './aiStatusModel'
import { chartIsEmpty, smallGraphs, X_KEY, xFormatterFor } from './aiStatusModel'

/** 작은 그래프 그리드 — 정의 kind(line|bar)에 따라 차트를 고르고 카드마다 모델의 aria-label·포매터를 그대로 쓴다. */
export function AiStatusSmallGraphs({
  series,
  bucketSeconds,
}: {
  series: Series
  /** 응답 구간 길이(초) — x 축 라벨 형식을 이 값으로 고른다(xFormatterFor). */
  bucketSeconds: number
}) {
  const isMobile = useIsMobile()
  const defs = useMemo(() => smallGraphs(series), [series])
  // 구간 키는 ISO 시각 — 구간 길이에 맞는 x 표기를 모든 차트(축·툴팁)에 준다
  const xFormatter = useMemo(() => xFormatterFor(bucketSeconds), [bucketSeconds])
  // 카드마다 스스로 빈 상태를 맡는다 — 로딩·오류는 페이지가 스켈레톤·LoadErrorState 로 이미 그린다(설계 §5-4)
  return (
    <div
      data-testid="ai-status-small-graphs"
      className={isMobile ? 'grid grid-cols-1 gap-4' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}
    >
      {defs.map((def) => (
        <div key={def.testId} data-testid={def.testId}>
          <ChartCard title={def.title} state={chartIsEmpty(def.rows, def.series) ? 'empty' : undefined}>
            {def.kind === 'bar' ? (
              <StackedBarChart<ChartRow>
                data={def.rows}
                xKey={X_KEY}
                xFormatter={xFormatter}
                series={def.series}
                valueFormatter={def.valueFormatter}
                aria-label={def.ariaLabel}
              />
            ) : (
              <TrendChart<ChartRow>
                data={def.rows}
                xKey={X_KEY}
                xFormatter={xFormatter}
                series={def.series}
                limit={def.limit}
                valueFormatter={def.valueFormatter}
                aria-label={def.ariaLabel}
              />
            )}
          </ChartCard>
        </div>
      ))}
    </div>
  )
}
