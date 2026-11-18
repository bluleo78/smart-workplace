// 노트에 이어진 일정 한 줄의 표시 문구·이동 주소(WP-1703).
// 날짜·시각은 캘린더 상세 보기와 같은 공용 부품(formatMonthDayWeekdayClock·formatLocalDateWithWeekday)으로 만든다 —
// 노트 하단 패널이 캘린더 화면과 다른 표기를 내지 않게.
import type { NoteLinkedEvent } from '../types/calendar'
import { allDayLocalDate } from './calendar'
import { formatLocalDateWithWeekday, formatMonthDayWeekdayClock } from './formatters'

/**
 * 보조 글 — 「11월 18일 (수) 오전 10:00 · 참석 5명」. 종일은 시각 대신 「종일」, 참석자가 없으면(0명) 뒷부분을 생략한다.
 * 종일 일정은 UTC 자정이 아니라 날짜 값이라 allDayLocalDate 로 날짜를 읽는다(하루 밀림 방지).
 * now 는 「올해면 연도 생략」 판정용(테스트에서 고정).
 */
export function linkedEventMeta(
  e: Pick<NoteLinkedEvent, 'startsAt' | 'allDay' | 'attendeeCount'>,
  now: Date = new Date(),
): string {
  const when = e.allDay
    ? `${formatLocalDateWithWeekday(allDayLocalDate(e.startsAt), now)} 종일`
    : formatMonthDayWeekdayClock(e.startsAt, now)
  return e.attendeeCount > 0 ? `${when} · 참석 ${e.attendeeCount}명` : when
}

/**
 * 캘린더 딥링크 — 반복 회차면 occurrence 를 붙여 그 회차 상세를 연다(CalendarPage 의 ?occurrence 처리가 읽는다).
 * 「이 회차만」 옮긴 회차는 일정 목록에 마스터 회차가 아니라 override 단일 행으로만 있어 (마스터, 회차)로는 찾지 못하고
 * 마스터가 열린다 — override id 로 바로 연다(WP-1703). 캘린더에서 그 회차를 누를 때와 같은 경로다.
 */
export function linkedEventHref(e: Pick<NoteLinkedEvent, 'eventId' | 'occurrenceDate' | 'overrideEventId'>): string {
  if (e.overrideEventId != null) return `/calendar?eventId=${e.overrideEventId}`
  const base = `/calendar?eventId=${e.eventId}`
  return e.occurrenceDate ? `${base}&occurrence=${encodeURIComponent(e.occurrenceDate)}` : base
}
