/**
 * 공용 차트(TrendChart·StackedBarChart)의 props 타입 (WP-1822).
 * 껍데기(지연 로딩)와 impl(Recharts)이 같은 타입을 쓰되, 이 파일은 recharts 를 가져오지 않아
 * 껍데기가 정적으로 import 해도 묶음에 Recharts 가 끼지 않는다.
 */
import type { ChartColorIndex } from './chartColors'

/** 높이 기본값(px) — height 를 안 주면 */
export const DEFAULT_CHART_HEIGHT = 200

/** 너비 기본값(px) — width 를 안 줘도 ChartContainer 의 초기 크기(initialDimension)로 쓴다 */
export const DEFAULT_CHART_WIDTH = 320

/** 계열 하나 — key 는 데이터 행의 값 필드, colorIndex 는 고정 배정된 색 번호 */
export type ChartSeries = { key: string; label: string; colorIndex: ChartColorIndex }

/** 한도(기준선) — 점선과 라벨로 그린다 */
export type ChartLimit = { value: number; label: string }

export type BaseChartProps<D> = {
  data: D[]
  /** X 축으로 쓸 데이터 필드 */
  xKey: keyof D & string
  series: ChartSeries[]
  limit?: ChartLimit
  /** 툴팁·축의 값 표기 */
  valueFormatter?: (v: number) => string
  /** X 축 눈금 표기 */
  xFormatter?: (v: unknown) => string
  /** 고정 높이(px). 없으면 부모 폭에 맞춘 반응형 */
  height?: number
  /** 고정 너비(px). 주면 부모 크기를 재지 않고 이 크기로 그린다(주로 jsdom 테스트용) */
  width?: number
  'aria-label': string
}

export type StackedBarChartProps<D> = BaseChartProps<D> & { onBarClick?(datum: D): void }
