// 비서 사용 한도 대기 표시(WP-2108) — 서버가 준 풀리는 시각(ISO)을 브라우저 로컬 시각으로 보인다.
// (서버가 쓰는 알림·즉답 문구는 KST 라 시간대가 다르면 어긋날 수 있다 — 웹의 다른 시각 표시와 맞춘 선택.)

import { formatTodayOrMonthDayClock, parseUtcDate } from './formatters'

/**
 * 「한도 대기」 배지 글자 — 대기 시각이 없거나 읽을 수 없거나 이미 지났으면 null(배지를 그리지 않는다), 아니면 `한도 대기 · 15:30 이후`(풀리는 시각은 오늘이면 `HH:mm`, 다른 날이면 `M월 d일 HH:mm` — 브라우저 로컬 시각, 공통 포매터).
 * 서버가 이미 지난 대기는 null 로 주지만, 화면을 연 채로 시각이 지나는 경우를 위해 한 번 더 거른다.
 */
export function limitWaitBadgeText(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const t = parseUtcDate(iso).getTime()
  // 읽을 수 없는 시각이면 「NaN:NaN」 대신 배지를 그리지 않는다.
  if (Number.isNaN(t) || t <= now.getTime()) return null
  return `한도 대기 · ${formatTodayOrMonthDayClock(iso, now)} 이후`
}
