// 통합 검색 「캘린더」 결과(WP-1357) — 서버의 일정 검색 한 줄(Item)을 팔레트 한 줄(SearchHit)로 바꾸는 순수 함수.
// 날짜·시각 표기는 lib/formatters 공용 포매터만 쓴다. 반복 요약은 일정 상세와 같은 recurrenceLabel 을 재사용한다.
import { CalendarDays, Repeat } from 'lucide-react'

import { calendarEventPath } from '@/lib/appUrl'
import { allDayLocalDate } from '@/lib/calendar'
import { recurrenceLabel } from '@/lib/calendarEventView'
import { formatInstantMonthDay, formatLocalClockTime24, formatLocalDateWithWeekday } from '@/lib/formatters'
import type { CalendarEventSearchItem } from '@/types/calendar'

import type { SearchHit } from './searchProviders'

/** 종류 탭의 소제목. */
export const GROUP_UPCOMING = '다가오는 일정'
export const GROUP_PAST = '지난 일정'

/**
 * 시각 표기 — 자세히는 「11월 6일 (목) 10:00」(종일이면 「… 종일」), 짧게는 요일 없이 「11월 6일 10:00」.
 * 올해가 아니면 연도를 앞에 붙인다(포매터가 처리). 종일 일정은 날짜 값이라 allDayLocalDate 로 날짜를 복원한다.
 */
/** 맞은 필드 → 스니펫 앞 라벨(제목으로 맞으면 스니펫 없음) */
const FIELD_LABEL = { LOCATION: '장소', ATTENDEE: '참석자' } as const

function whenText(iso: string, allDay: boolean, withWeekday: boolean, now: Date): string {
  const date = allDay ? allDayLocalDate(iso) : new Date(iso)
  const day = withWeekday ? formatLocalDateWithWeekday(date, now) : formatInstantMonthDay(date.toISOString(), now)
  return `${day} ${allDay ? '종일' : formatLocalClockTime24(iso)}`
}

/** 「매주 금요일」 → 「매주 금」 — 한 줄에 들어가게 요일의 「요일」만 뺀다(그 밖의 말은 그대로). */
function shortRecurrence(label: string): string {
  return label.replace(/([월화수목금토일])요일/, '$1')
}

/** 검색 결과 한 줄 → 팔레트 한 줄. now 는 올해 판정용(테스트가 고정한다). */
export function toCalendarHit(item: CalendarEventSearchItem, now: Date = new Date()): SearchHit {
  const recurring = !!item.recurrenceRule?.trim()
  const rule = recurring ? recurrenceLabel(item, now) : null
  // 반복은 「매주 금 · 다음 11월 7일 16:00」(끝난 시리즈는 「마지막」), 단일은 시작 시각.
  const nextLabel = item.past ? '마지막' : '다음'
  const meta = recurring
    ? `${shortRecurrence(rule ?? '반복')} · ${nextLabel} ${whenText(item.occurrenceStart, item.allDay, false, now)}`
    : whenText(item.startsAt, item.allDay, true, now)
  const metaShort = whenText(recurring ? item.occurrenceStart : item.startsAt, item.allDay, false, now)
  const label = item.matchedField === 'TITLE' ? null : FIELD_LABEL[item.matchedField]
  return {
    key: `calendar:${item.id}`,
    app: 'calendar',
    title: item.title,
    href: calendarEventPath(item.id),
    meta,
    metaShort,
    tag: { name: item.calendarName, color: item.calendarColor },
    // TITLE 이면 둘째 줄 없음 — 장소·참석자에서 맞았을 때만 어디서 맞았는지 보인다.
    ...(label && item.matchedText ? { snippet: item.matchedText, snippetLabel: label } : {}),
    group: item.past ? GROUP_PAST : GROUP_UPCOMING,
    dimmed: item.past,
    icon: recurring ? Repeat : CalendarDays,
  }
}
