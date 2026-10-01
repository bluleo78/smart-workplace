// 캘린더 위젯 조회 범위 계산 — 카탈로그 CalendarWidget 과 모바일 요약 한 줄이 같은 쿼리 키(from/to)를 쓰도록 한곳에 둔다(WP-142).
//
// from/to 범위를 ISO datetime 으로 정규화한다(#460).
// AI 가 show_calendar 에 date-only("2026-06-22") 를 줄 수 있으나, 백엔드 /calendar/events 는
// @DateTimeFormat(ISO.DATE_TIME) OffsetDateTime 을 요구하므로 date-only 를 그대로 보내면 400 이 난다.
// from = 시작일 00:00, to = 종료일 +1일 00:00(종료일 포함 = exclusive end). 미지정 시 오늘.
// from==to(단일일)·to 미지정·역전 범위 모두 최소 하루 범위로 보정해 빈 범위를 방지한다.
// params.range('today'|'week')는 홈 대시보드 카탈로그 위젯(catalogRegistry)의 "기간" 필터가 보내는 상대 범위 —
// "오늘"은 from/to 미지정과 동일 효과, "week"는 오늘부터 7일 범위. 렌더 시점 기준으로 매번 계산해 정적 옵션값이 낡지 않게 한다.
export function resolveCalendarRange(params?: Record<string, unknown> | null): { from: string; to: string } {
  // 문자열(date-only 또는 ISO)을 그 날 로컬 00:00 Date 로 파싱. 유효하지 않으면 null.
  const startOfDay = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v.trim()) return null
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    d.setHours(0, 0, 0, 0)
    return d
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const fromDate = startOfDay(params?.from) ?? today
  let toDay = startOfDay(params?.to) ?? fromDate
  if (params?.range === 'week' && !params?.to) {
    toDay = new Date(fromDate)
    toDay.setDate(toDay.getDate() + 6)
  }
  // 종료일을 포함하도록 +1일. 역전(to<from) 시 from 기준으로 보정.
  const toExclusive = new Date(Math.max(toDay.getTime(), fromDate.getTime()))
  toExclusive.setDate(toExclusive.getDate() + 1)
  return { from: fromDate.toISOString(), to: toExclusive.toISOString() }
}
