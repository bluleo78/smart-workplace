// 날짜 구분선 — 날짜가 바뀌는 메시지 사이에 삽입된다.
// Slack/Discord 패턴: 좌우 구분선 + 중앙 날짜 텍스트.
// parseUtcDate 로 서버 LocalDateTime(UTC) 을 정확히 파싱하고, KST 기준 날짜를 표시한다.

import { parseUtcDate } from '@/lib/formatters'

interface DateDividerProps {
  /** ISO datetime string (서버 UTC LocalDateTime) */
  date: string
}

export function DateDivider({ date }: DateDividerProps) {
  const d = parseUtcDate(date)
  const label = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  }).format(d)

  return (
    <div
      className="flex items-center gap-2 py-2"
      data-testid="date-divider"
      aria-hidden="true"
    >
      <div className="flex-1 border-t" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex-1 border-t" />
    </div>
  )
}
