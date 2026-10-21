// 메일 목록 행의 시각 — 받은편지함 행(받은 시각)과 임시보관함 행(저장 시각, WP-577)이 같은 표기를 쓴다.
import { formatClockTimePadded, formatDateMonthDayPadded, parseUtcDate } from '@/lib/formatters'

/** 간략 표기 — 오늘이면 시각(HH:mm), 그 외는 월/일. 값이 없으면 빈 문자열. */
export function formatReceivedAt(iso: string | null): string {
  if (!iso) return ''
  const d = parseUtcDate(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? formatClockTimePadded(iso) : formatDateMonthDayPadded(iso)
}
