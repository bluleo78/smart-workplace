/**
 * StackedBarChart 의 Recharts 구현 (WP-1822). 껍데기(StackedBarChart.tsx)가 lazy import 한다.
 * 규격(설계 §7-1): 한 stackId 로 쌓고, 막대 사이 2px 는 표면색 stroke 로, 맨 위 계열만 위 끝을 둥글게,
 * 가로 점선 격자, 12px muted 축 글자, 계열 2개 이상이면 범례, limit 은 점선+라벨.
 */
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart'

import { buildChartConfig } from './chartColors'
import { asChartRows, isTopSegment } from './chartData'
import { buildTooltipContent } from './chartTooltip'
import { DEFAULT_CHART_HEIGHT, DEFAULT_CHART_WIDTH, type StackedBarChartProps } from './chartTypes'

/** 차트 바깥 여백 — 매 렌더 새 객체가 되지 않게 모듈 상수로 둔다 */
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
/** 축 눈금 글자(12px muted) */
const AXIS_TICK = { className: 'text-xs fill-muted-foreground' }

export default function StackedBarChartImpl<D>({
  data,
  xKey,
  series,
  limit,
  valueFormatter,
  xFormatter,
  height,
  width,
  onBarClick,
  'aria-label': ariaLabel,
}: StackedBarChartProps<D>) {
  const config = useMemo(() => buildChartConfig(series), [series])
  // XAxis 의 dataKey 는 행 레코드(Record<string, unknown>) 기준이라 제네릭 keyof D 대신 string 으로 넓혀 넘긴다
  const xDataKey: string = xKey
  const h = height ?? DEFAULT_CHART_HEIGHT
  // 고정 크기 처리는 TrendChart.impl 과 같다(바깥 div 고정 + initialDimension).
  // 막대를 누를 수 있으면 root 를 img 로 두지 않는다(img 는 안쪽 상호작용 요소를 보조기기에서 숨긴다)
  const fixed = width !== undefined
  return (
    <ChartContainer
      config={config}
      role={onBarClick ? 'group' : 'img'}
      aria-label={ariaLabel}
      className="aspect-auto w-full"
      style={fixed ? { width, height: h } : { height: h }}
      initialDimension={{ width: width ?? DEFAULT_CHART_WIDTH, height: h }}
    >
      <BarChart data={asChartRows(data)} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" strokeOpacity={0.5} />
        <XAxis
          dataKey={xDataKey}
          tickLine={false}
          axisLine={false}
          tickFormatter={xFormatter}
          tick={AXIS_TICK}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={valueFormatter}
          tick={AXIS_TICK}
        />
        <ChartTooltip
          content={buildTooltipContent(config, xKey, xFormatter, valueFormatter)}
        />
        {series.length >= 2 && <ChartLegend content={<ChartLegendContent />} />}
        {limit && (
          <ReferenceLine
            y={limit.value}
            // 한도가 데이터 최댓값보다 커도 선이 버려지지 않게 Y 축 범위를 늘린다(기본값 discard 는 범위 밖 선을 지운다)
            ifOverflow="extendDomain"
            strokeDasharray="4 4"
            stroke="var(--muted-foreground)"
            label={{ value: limit.label, position: 'insideTopRight', className: 'text-xs fill-muted-foreground' }}
          />
        )}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="stack"
            fill={`var(--color-${s.key})`}
            // 막대 사이 2px 간격: 표면색 테두리로 만든다
            stroke="var(--background)"
            strokeWidth={2}
            // 열마다 실제로 맨 위에 보이는 막대(위 계열이 0/null 이면 그 아래 계열)만 위 끝을 둥글게
            shape={(p: React.ComponentProps<typeof Rectangle> & { payload?: unknown }) => (
              <Rectangle {...p} radius={isTopSegment(p.payload, series, i) ? [4, 4, 0, 0] : 0} />
            )}
            isAnimationActive={false}
            // Recharts 가 넘기는 막대 항목의 payload 가 원래 데이터 행이다
            onClick={onBarClick ? (item: { payload?: unknown }) => onBarClick(item.payload as D) : undefined}
            cursor={onBarClick ? 'pointer' : undefined}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
