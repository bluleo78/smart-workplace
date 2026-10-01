// 요약 위젯 날짜 헬퍼(WP-142) — SynthesisLayer(데스크톱)와 useSynthesisCounts(모바일 접힘 한 줄)가 같은 날짜 규칙을 쓰도록
// 한곳에 둔다. 쿼리 키(from/to)가 어긋나면 TanStack Query 가 요청을 합치지 못하므로 규칙을 복제하지 않는다.

/** 오늘 00:00~24:00(로컬) ISO 범위 — CalendarTodayBody 와 동일 규칙으로 캘린더 쿼리 dedupe. */
export function todayRange(): { from: string; to: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

/** yyyy-MM-dd(로컬) — 마감일(LocalDate) 비교용. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 마감 이슈 조회 시작 시각 — 기준일의 1년 전(지남+오늘 마감을 한 번에 조회하기 위한 하한). */
export function dueQueryFrom(today: Date): string {
  const from = new Date(today)
  from.setFullYear(from.getFullYear() - 1)
  return from.toISOString()
}
