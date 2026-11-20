/** 차트 데이터에 그릴 값이 하나라도 있는지 — 빈 배열이거나 모든 계열 값이 null/없음이면 false (recharts 무관, 껍데기가 쓴다) */
export function hasAnyValue<D>(data: D[], series: { key: string }[]): boolean {
  return data.some((row) =>
    series.some((s) => {
      const v = (row as Record<string, unknown>)[s.key]
      return v !== null && v !== undefined
    }),
  )
}

/** 이 행에서 series[idx] 가 가장 위에 보이는 막대(그 위 계열이 모두 0/null)인지 — 위 끝 둥글게를 어느 계열에 줄지 정한다 */
export function isTopSegment(row: unknown, series: { key: string }[], idx: number): boolean {
  const r = row as Record<string, unknown>
  const own = r[series[idx].key]
  if (!own) return false
  // 그 위 계열(idx+1~)이 모두 0/null 이어야 맨 위 — 배열을 새로 만들지 않고 직접 돈다
  for (let i = idx + 1; i < series.length; i++) {
    if (r[series[i].key]) return false
  }
  return true
}

/** 차트 데이터를 Recharts 가 받는 행 배열로 본다 — 제네릭 D 를 행 레코드로 보는 형 단언을 이 한곳에 모은다 */
export function asChartRows<D>(data: D[]): Record<string, unknown>[] {
  return data as unknown[] as Record<string, unknown>[]
}
