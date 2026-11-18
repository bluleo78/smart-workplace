// 일정 회의록 노트 줄의 순수 함수(WP-1701).
import type { CalendarEvent } from '@/types/calendar'

import { formatRelativeTime } from './formatters'

/**
 * 카드·검색 결과의 메타 줄 — `공간 · 고친 사람 · 10분 전 수정`.
 * 고친 사람이 없으면(한 번도 고치지 않은 새 노트) 그 칸과 구분점을 함께 뺀다 — 빈 구분점이 남지 않게.
 */
export function noteMetaLine(
  p: { spaceName?: string; updatedByName?: string | null; updatedAt?: string },
  now?: Date,
): string {
  return [p.spaceName, p.updatedByName, p.updatedAt ? `${formatRelativeTime(p.updatedAt, now)} 수정` : null]
    .filter((part): part is string => !!part)
    .join(' · ')
}

/**
 * 회의록 줄을 그릴 수 있는 일정인가 — 반복 일정은 회차 날짜가 있어야 한다(WP-1701).
 * 회차 없이 열린 반복 마스터(`?eventId=` 딥링크가 마스터를 돌려준 경우)는 서버가 잇기·조회를 400 으로 거절하므로 줄을 아예 숨긴다.
 * 고친 회차(override, 반복 규칙 없음)·단일 일정은 회차 날짜 없이도 된다.
 */
export function canShowNoteRow(event: Pick<CalendarEvent, 'recurrenceRule' | 'occurrenceDate'> | null | undefined): boolean {
  if (!event) return false
  return !event.recurrenceRule || event.occurrenceDate != null
}

/**
 * 새로 만든 반복 일정의 실제 첫 회차 — 만든 뒤 목록 조회로 펼친 회차 중 그 시리즈(masterEventId)의 가장 이른 occurrenceDate.
 * DTSTART 가 RRULE 에 안 맞으면(월요일 시작·화·목 반복) 전개가 DTSTART 를 회차로 내지 않아 startsAt 을 쓰면 400 이 된다(WP-1701).
 * 없으면 null.
 */
export function firstOccurrenceDate(
  masterId: number,
  items: Pick<CalendarEvent, 'masterEventId' | 'occurrenceDate'>[],
): string | null {
  let best: string | null = null
  for (const e of items) {
    if (e.masterEventId !== masterId || !e.occurrenceDate) continue
    if (best === null || new Date(e.occurrenceDate).getTime() < new Date(best).getTime()) best = e.occurrenceDate
  }
  return best
}
