// AI 현황 개요의 작은 그래프 자리(WP-1824) — 모델이 만든 정의 5개(응답 시간·실패·대기·밀린 건수·동시 처리)를
// 카드로 조립한다. 데스크톱은 2열(sm)·3열(xl), 모바일은 한 열(설계 §5-3 5).
// 정의를 한 번에 다 그리면 데이터 도착 직후 메인 스레드가 막히므로(WP-2079), 카드를 한 장씩 나눠 그린다.
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import type { Series } from '@/api/aiStatus'
import { ChartCard } from '@/components/metrics/ChartCard'
import { StackedBarChart } from '@/components/metrics/StackedBarChart'
import { TrendChart } from '@/components/metrics/TrendChart'
import { useIsMobile } from '@/hooks/useIsMobile'

import type { ChartRow } from './aiStatusModel'
import { chartIsEmpty, smallGraphs, X_KEY, xFormatterFor } from './aiStatusModel'

/**
 * 한 카드 — 그리드가 다시 그려질 때(단계가 늘어날 때) 이미 그린 카드가 같이 다시 렌더되지 않게 memo 로 막는다.
 * props 는 정의 원소와 x 표기 함수뿐이라 비교가 값 기준으로 끝난다.
 */
const SmallGraphCard = memo(function SmallGraphCard({
  def,
  xFormatter,
}: {
  def: ReturnType<typeof smallGraphs>[number]
  xFormatter: (v: unknown) => string
}) {
  return (
    <div data-testid={def.testId}>
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
  )
})

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
  // 그려야 할 카드 수 — 0 에서 정의 수까지 타이머 체인으로 한 장씩 늘려, 데이터 도착 직후 한 번에 몰리지 않게 나눈다
  const [visibleCards, setVisibleCards] = useState(0)
  useEffect(() => {
    if (visibleCards >= defs.length) return
    // 다음 카드는 자기 태스크(0ms 타이머)에서 그린다 — 임의의 지연값을 두지 않아 사용자 체감 지연이 없다
    const id = window.setTimeout(() => setVisibleCards((n) => n + 1), 0)
    return () => window.clearTimeout(id)
  }, [visibleCards, defs.length])
  // 기간 토글로 정의가 바뀌면 새 길이만큼 바로 그린다 — 진행 중이던 단계 체인에 빈칸이 남지 않게
  const prevDefs = useRef(defs)
  useEffect(() => {
    if (prevDefs.current === defs) return
    prevDefs.current = defs
    setVisibleCards(defs.length)
  }, [defs])
  // 구간 키는 ISO 시각 — 구간 길이에 맞는 x 표기를 모든 차트(축·툴팁)에 준다
  const xFormatter = useMemo(() => xFormatterFor(bucketSeconds), [bucketSeconds])
  // 카드마다 스스로 빈 상태를 맡는다 — 로딩·오류는 페이지가 스켈레톤·LoadErrorState 로 이미 그린다(설계 §5-4)
  return (
    <div
      data-testid="ai-status-small-graphs"
      className={isMobile ? 'grid grid-cols-1 gap-4' : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'}
    >
      {defs.slice(0, visibleCards).map((def) => (
        <SmallGraphCard key={def.testId} def={def} xFormatter={xFormatter} />
      ))}
    </div>
  )
}
