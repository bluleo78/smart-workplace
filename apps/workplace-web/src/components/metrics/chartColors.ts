/**
 * 차트 색 배정 (WP-1822).
 * 계열 색은 순위가 아니라 "고정 배정"이다 — 같은 대상은 어느 화면에서나 같은 색 번호를 쓴다.
 * 6번째부터는 구분하지 않고 '기타' 회색(--chart-other)으로 묶는다.
 */

import type { ChartConfig } from '@/components/ui/chart'

import type { ChartSeries } from './chartTypes'

/** 1~5: 계열 색, 'other': 기타 회색 */
export type ChartColorIndex = 1 | 2 | 3 | 4 | 5 | 'other'

/** 고정 배정에 쓰는 계열 색 번호 다섯 개 */
const SERIES_COLOR_INDEXES: ChartColorIndex[] = [1, 2, 3, 4, 5]

/** i 번째(0 부터) 계열의 색 번호 — 6번째부터는 'other' 회색 */
export function colorIndexFor(i: number): ChartColorIndex {
  return SERIES_COLOR_INDEXES[i] ?? 'other'
}

/** 색 번호 → CSS 변수 참조 문자열 (index.css 의 --chart-1..5, --chart-other) */
export function chartColorVar(i: ChartColorIndex): string {
  return `var(--chart-${i})`
}

/**
 * 계열 → ChartContainer config. 색은 고정 배정 CSS 변수라 다크 모드도 변수가 바꿔 준다.
 * (import type 만 써서 Recharts 를 끌고 오지 않는다)
 */
export function buildChartConfig(series: ChartSeries[]): ChartConfig {
  const entries: [string, ChartConfig[string]][] = []
  for (const s of series) {
    const safe = safeColorKey(s.key)
    // 색은 안전한 이름 항목에만 싣는다 — shadcn ChartStyle 이 config 키를 그대로 `--color-<키>` 로 쓰기 때문이다
    entries.push([safe, { label: s.label, color: chartColorVar(s.colorIndex) }])
    // 키가 바뀌었으면 원래 키로도 라벨을 찾을 수 있게 색 없는 항목을 남긴다(툴팁·범례가 dataKey 로 조회)
    if (safe !== s.key) entries.push([s.key, { label: s.label }])
  }
  return Object.fromEntries(entries)
}

/**
 * 계열 key → CSS 사용자 지정 속성 이름에 쓸 안전한 식별자.
 * `ai.tokens` 같은 키가 `--color-ai.tokens` 로 들어가면 var() 참조가 깨져 계열 색이 사라지므로,
 * 영문·숫자·`_`·`-` 밖의 글자는 `_` 로 바꾼다. 데이터 필드 이름(dataKey)은 건드리지 않고 색 변수 이름에만 쓴다.
 */
export function safeColorKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** 계열 key 의 색 참조 `var(--color-<안전한 키>)` — 선·막대·점·툴팁 견본이 같은 변수 이름을 쓰도록 한곳에서 만든다 */
export function seriesColorVar(key: string): string {
  return `var(--color-${safeColorKey(key)})`
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
