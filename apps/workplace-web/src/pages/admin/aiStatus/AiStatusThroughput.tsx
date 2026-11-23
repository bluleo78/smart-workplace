// AI 현황 개요의 처리량 자리(WP-1824) — 종류별 처리량을 쌓은 막대로 그리고, 토큰·건수 단위를 나눠 보여 준다.
// 모바일 폭에서는 막대를 12개 이하로 다시 묶는다(mergeChartRows — 단위 합은 표시용 재배치일 뿐 지표 재집계가 아니다, 설계 §5-6 1).
// 막대를 누르면 그 시간대의 처리 이력(/settings/ai-status/history?from=…&to=…)으로 간다 — 묶은 막대는 묶은 구간 전체다(WP-1824 리뷰).
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { AiStatusPeriod, Throughput } from '@/api/aiStatus'
import { ChartCard } from '@/components/metrics/ChartCard'
import { PeriodToggle } from '@/components/metrics/PeriodToggle'
import { StackedBarChart } from '@/components/metrics/StackedBarChart'
import { useIsMobile } from '@/hooks/useIsMobile'
import { formatCompactNumber, formatNumber } from '@/lib/formatters'

import type { AiStatusUnit, ChartRow } from './aiStatusModel'
import {
  bucketHistoryHref,
  chartIsEmpty,
  mergeChartRows,
  mergeStep,
  periodLabel,
  throughputRows,
  throughputSeries,
  X_KEY,
  xFormatterFor,
} from './aiStatusModel'

/** 단위 전환 단추 두 개 — 기본은 토큰(설계 §5-3 4). */
const UNIT_OPTIONS: { value: AiStatusUnit; label: string }[] = [
  { value: 'tokens', label: '토큰' },
  { value: 'count', label: '건수' },
]

/** 모바일 폭의 막대 수 상한 — 넘으면 이웃 구간을 묶는다(설계 §5-6 1). */
const MOBILE_MAX_BARS = 12

/** 처리량 블록 — 단위 상태만 이 컴포넌트가 들고, 행·계열·재묶음은 모델 순수 함수에 맡긴다. */
export function AiStatusThroughput({
  throughput,
  period,
  bucketSeconds,
  windowEnd,
}: {
  throughput: Throughput
  period: AiStatusPeriod
  /** 응답 구간 길이(초) — x 축 라벨 형식을 이 값으로 고른다(7일 6시간 구간이 날짜만으로 겹치지 않게). */
  bucketSeconds: number
  /** 개요 창의 끝(응답 to) — 막대 링크의 to 가 이 시각을 넘지 않게 자른다(모바일 마지막 묶음). */
  windowEnd: string
}) {
  const [unit, setUnit] = useState<AiStatusUnit>('tokens')
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  // 파생 값은 응답·단위·폭이 바뀔 때만 다시 계산한다
  const rows = useMemo(() => throughputRows(throughput, unit), [throughput, unit])
  const data = useMemo(() => (isMobile ? mergeChartRows(rows, MOBILE_MAX_BARS) : rows), [isMobile, rows])
  const series = useMemo(() => throughputSeries(throughput), [throughput])
  const xFormatter = useMemo(() => xFormatterFor(bucketSeconds), [bucketSeconds])
  // 막대 하나가 덮는 시간 — 모바일에서 n개씩 묶었으면 구간 길이 × n(mergeChartRows 와 같은 묶음 크기)
  const spanSeconds = bucketSeconds * (isMobile ? mergeStep(rows.length, MOBILE_MAX_BARS) : 1)
  // 손잡이 정체성을 지켜 차트가 부모 다시 그리기마다 막대를 다시 그리지 않게 한다
  const openBucket = useCallback(
    (row: ChartRow) => {
      const href = bucketHistoryHref(row[X_KEY], spanSeconds, windowEnd)
      if (href) navigate(href)
    },
    [navigate, spanSeconds, windowEnd],
  )
  // 빈 구간만 이 카드가 「데이터 없음」 으로 맡는다 — 로딩·오류는 페이지가 스켈레톤·LoadErrorState 로 이미 그린다(설계 §5-4)
  const chartState = chartIsEmpty(rows, series) ? 'empty' : undefined
  return (
    <div data-testid="ai-status-throughput">
      <ChartCard
        title="처리량"
        state={chartState}
        actions={<PeriodToggle options={UNIT_OPTIONS} value={unit} onChange={setUnit} aria-label="단위" />}
      >
        <StackedBarChart<ChartRow>
          data={data}
          xKey={X_KEY}
          xFormatter={xFormatter}
          series={series}
          valueFormatter={unit === 'tokens' ? formatCompactNumber : formatNumber}
          onBarClick={openBucket}
          aria-label={`${periodLabel(period)} 처리량`}
        />
      </ChartCard>
    </div>
  )
}
