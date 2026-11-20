/**
 * 차트 툴팁 공용 (WP-1822) — 머리글·행 포맷터와, 둘을 단 ChartTooltipContent 요소를 한곳에 둔다.
 * TrendChart.impl·StackedBarChart.impl 이 같은 툴팁을 쓴다(recharts 를 쓰는 impl 쪽에서만 import 한다).
 */
import { type ChartConfig, ChartTooltipContent } from '@/components/ui/chart'

/**
 * 툴팁 머리글 포맷터를 만든다. ChartTooltipContent 는 label 이 문자열일 때만 쓰고 아니면 계열 이름으로 되돌리므로,
 * 숫자 x(타임스탬프 등)도 올바르게 보이도록 payload 의 원래 데이터 행에서 x 값을 직접 읽는다.
 * xFormatter 가 있으면 원본 x 값을 그대로 넘기고, 없으면 String(raw).
 */
export function makeTooltipLabelFormatter(xKey: string, xFormatter?: (v: unknown) => string) {
  return (_: unknown, payload: ReadonlyArray<{ payload?: unknown }> | undefined): string => {
    const raw = (payload?.[0]?.payload as Record<string, unknown> | undefined)?.[xKey]
    if (raw === undefined || raw === null) return ''
    return xFormatter ? xFormatter(raw) : String(raw)
  }
}

/** Recharts 가 formatter 에 넘기는 항목 중 쓰는 부분 */
type RowItem = { dataKey?: unknown }

/**
 * 툴팁 한 줄. valueFormatter 를 쓰면 ChartTooltipContent 의 기본 행이 통째로 교체되어
 * 색 표시가 사라지므로, 색 칩 + 계열 이름 + 포맷된 값을 기본 행과 비슷한 배치로 직접 그린다.
 * valueFormatter 가 없으면 undefined(기본 행 사용).
 */
export function makeTooltipRowFormatter(config: ChartConfig, valueFormatter?: (v: number) => string) {
  if (!valueFormatter) return undefined
  return function TooltipRow(value: unknown, name: unknown, item: RowItem) {
    const key = String(item.dataKey)
    return (
      <>
        <span
          data-testid="tooltip-swatch"
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: `var(--color-${key})` }}
        />
        <span className="flex flex-1 items-center justify-between gap-4 leading-none">
          <span className="text-muted-foreground">{config[key]?.label ?? String(name)}</span>
          <span className="font-mono font-medium text-foreground tabular-nums">{valueFormatter(Number(value))}</span>
        </span>
      </>
    )
  }
}

/** 두 impl 이 ChartTooltip 의 content 로 넘기는, 머리글·행 포맷터를 단 ChartTooltipContent 요소 */
export function buildTooltipContent(
  config: ChartConfig,
  xKey: string,
  xFormatter?: (v: unknown) => string,
  valueFormatter?: (v: number) => string,
) {
  return (
    <ChartTooltipContent
      labelFormatter={makeTooltipLabelFormatter(xKey, xFormatter)}
      formatter={makeTooltipRowFormatter(config, valueFormatter)}
    />
  )
}
