/**
 * TrendChart 의 Recharts 구현 (WP-1822). 껍데기(TrendChart.tsx)가 lazy import 한다 —
 * Recharts 는 무거워서 차트를 쓰는 화면만 받도록 이 파일에만 둔다.
 * 규격(설계 §7-1): 선 2px·점 없음(양옆이 null 인 고립된 점만 점으로)·null 은 끊기, 가로 점선 격자, 12px muted 축 글자,
 * 계열 2개 이상이면 범례, 툴팁은 세로 기준선, limit 은 점선+라벨.
 */
import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from '@/components/ui/chart'

import { buildChartConfig, seriesColorVar } from './chartColors'
import { asChartRows, isIsolatedPoint } from './chartData'
import { buildTooltipContent } from './chartTooltip'
import { type BaseChartProps, DEFAULT_CHART_HEIGHT, DEFAULT_CHART_WIDTH } from './chartTypes'

/** 차트 바깥 여백 — 매 렌더 새 객체가 되지 않게 모듈 상수로 둔다 */
const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
/** 축 눈금 글자(12px muted) */
const AXIS_TICK = { className: 'text-xs fill-muted-foreground' }

export default function TrendChartImpl<D>({
  data,
  xKey,
  series,
  limit,
  valueFormatter,
  xFormatter,
  height,
  width,
  'aria-label': ariaLabel,
}: BaseChartProps<D>) {
  const config = useMemo(() => buildChartConfig(series), [series])
  // XAxis 의 dataKey 는 행 레코드(Record<string, unknown>) 기준이라 제네릭 keyof D 대신 string 으로 넓혀 넘긴다
  const xDataKey: string = xKey
  const rows = useMemo(() => asChartRows(data), [data])
  const h = height ?? DEFAULT_CHART_HEIGHT
  // 고정 크기: ChartContainer 는 항상 ResponsiveContainer 를 쓰므로(수정 금지) 바깥 div 를 고정 크기로 두고
  // initialDimension 을 같은 값으로 줘서, 레이아웃을 못 재는 jsdom 에서도 같은 크기로 그리게 한다.
  const fixed = width !== undefined
  return (
    <ChartContainer
      config={config}
      role="img"
      aria-label={ariaLabel}
      className="aspect-auto w-full"
      style={fixed ? { width, height: h } : { height: h }}
      initialDimension={{ width: width ?? DEFAULT_CHART_WIDTH, height: h }}
    >
      <LineChart data={rows} margin={CHART_MARGIN}>
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
          cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
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
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.label}
            type="monotone"
            stroke={seriesColorVar(s.key)}
            strokeWidth={2}
            // 점은 기본으로 안 그리되, 양옆이 비어 선이 안 이어지는 고립된 점·한 점짜리 계열은 점으로 보인다
            dot={(p: { cx?: number; cy?: number; index?: number }) =>
              p.index !== undefined && p.cx !== undefined && p.cy !== undefined && isIsolatedPoint(rows, s.key, p.index) ? (
                <circle
                  key={`${s.key}-${p.index}`}
                  data-testid="isolated-dot"
                  cx={p.cx}
                  cy={p.cy}
                  r={3}
                  fill={seriesColorVar(s.key)}
                />
              ) : (
                <g key={`${s.key}-${p.index}`} />
              )
            }
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}
