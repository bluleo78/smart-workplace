/**
 * 차트 색 배정 (WP-1822).
 * 계열 색은 순위가 아니라 "고정 배정"이다 — 같은 대상은 어느 화면에서나 같은 색 번호를 쓴다.
 * 6번째부터는 구분하지 않고 '기타' 회색(--chart-other)으로 묶는다.
 */

import type { ChartConfig } from '@/components/ui/chart'

import type { ChartSeries } from './chartTypes'

/** 1~5: 계열 색, 'other': 기타 회색 */
export type ChartColorIndex = 1 | 2 | 3 | 4 | 5 | 'other'

/** 색 번호 → CSS 변수 참조 문자열 (index.css 의 --chart-1..5, --chart-other) */
export function chartColorVar(i: ChartColorIndex): string {
  return `var(--chart-${i})`
}

/**
 * 계열 → ChartContainer config. 색은 고정 배정 CSS 변수라 다크 모드도 변수가 바꿔 준다.
 * (import type 만 써서 Recharts 를 끌고 오지 않는다)
 */
export function buildChartConfig(series: ChartSeries[]): ChartConfig {
  return Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: chartColorVar(s.colorIndex) }]))
}

/**
 * 값이 큰 순으로 상위 n 개를 남기고 나머지는 합쳐 '기타' 하나로 만든다.
 * 입력 배열은 바꾸지 않는다. 나머지가 없으면 other 는 null.
 * 기타의 데이터 key 는 항상 'other' 로 고정이고, 표시 이름은 호출자가 정한다.
 */
export function groupTopN<T extends { key: string; value: number }>(
  items: T[],
  n = 5,
): { top: T[]; other: { key: 'other'; value: number; count: number } | null } {
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, n)
  const rest = sorted.slice(n)
  if (rest.length === 0) return { top, other: null }
  return {
    top,
    other: { key: 'other', value: rest.reduce((s, i) => s + i.value, 0), count: rest.length },
  }
}
