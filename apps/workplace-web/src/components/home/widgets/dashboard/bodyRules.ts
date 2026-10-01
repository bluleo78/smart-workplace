// 홈 위젯 본문의 순수 표시 규칙(WP-142) — 데스크톱 본문(CalendarTodayBody·PriorityQuadrantBody·UnreadMailBody)과
// 모바일 요약 한 줄(summaryLogic·요약 컴포넌트)이 같은 기준을 쓰도록 한곳에 둔다. 컴포넌트 파일(.tsx)에서 함수를
// export 하면 react-refresh 규칙에 걸리고, 본문이 모바일 모듈에 의존하는 역방향 의존도 피하려고 별도 .ts 로 뺀다.
import type { PriorityItem } from '@/api/priorityItems'
import { formatLocalClockTime24, parseUtcDate } from '@/lib/formatters'
import type { CalendarEvent } from '@/types/calendar'
import type { MailSummaryItem } from '@/types/dashboard'

// ── 일정 시각 ─────────────────────────────────────────────────────────────

/** 일정 종류 — allday(종일)/timed(시각 있음)/untimed(시작시각 미정). */
export type TimeKind = 'allday' | 'timed' | 'untimed'

/**
 * 리딩 컬럼에 표시할 라벨 + 종류. startsAt 이 null/빈 문자열이면
 * '-'(의미 없는 placeholder) 대신 '미정' 으로 명시한다.
 */
export function eventTime(ev: CalendarEvent): { label: string; kind: TimeKind } {
  if (ev.allDay) return { label: '종일', kind: 'allday' }
  const d = parseUtcDate(ev.startsAt)
  if (Number.isNaN(d.getTime())) return { label: '미정', kind: 'untimed' }
  // 대시보드 컴팩트 표기 — 24시간제(예: 14:30)로 폭을 일정하게 유지.
  return {
    label: formatLocalClockTime24(ev.startsAt),
    kind: 'timed',
  }
}

/** 정렬 키 — 시작시각 오름차순. 미정(NaN)은 Infinity 로 밀어 항상 맨 뒤에 둔다. */
export function sortKey(ev: CalendarEvent): number {
  const t = parseUtcDate(ev.startsAt).getTime()
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

// ── AI 우선순위 사분면 ────────────────────────────────────────────────────

/** 사분면 키 — PriorityQuadrantBody 의 분면 data-testid 접미사와 같다. */
export type QuadrantKey = 'urgent-important' | 'important' | 'urgent' | 'low'

// 중요도·긴급도 임계값 — 이 값 이상이면 "중요"/"긴급"으로 본다.
const QUADRANT_THRESHOLD = 50

/** 항목이 속한 사분면 — 중요도·긴급도 각각 임계값(50) 이상 여부로 4분면을 가른다. */
export function quadrantOf(item: PriorityItem): QuadrantKey {
  const important = item.importanceScore >= QUADRANT_THRESHOLD
  const urgent = item.urgencyScore >= QUADRANT_THRESHOLD
  if (important && urgent) return 'urgent-important'
  if (important) return 'important'
  if (urgent) return 'urgent'
  return 'low'
}

// ── 메일 ─────────────────────────────────────────────────────────────────

/** 발신자 표시명 — name 우선, 없으면 주소, 둘 다 없으면 '(알 수 없음)'. */
export function mailSender(m: Pick<MailSummaryItem, 'fromName' | 'fromAddress'>): string {
  return m.fromName?.trim() || m.fromAddress || '(알 수 없음)'
}
