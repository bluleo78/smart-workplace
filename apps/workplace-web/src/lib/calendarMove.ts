// 일정 끌어 옮기기(WP-1328)의 순수 계산 — 놓은 칸·시간으로 새 시작·종료를 만들고, 옮길 수 있는 일정인지 판정하고,
// 저장 요청 바디를 조립한다. 화면(TimeGrid·MonthView)과 페이지(CalendarPage)가 함께 쓰며, 브라우저 없이 시험한다.
import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'

import { allDayLocalDate, DRAG_SLOT_MINUTES, DRAG_SLOT_PX } from '@/lib/calendar'
import type { Calendar, CalendarEvent, CalendarEventRequest } from '@/types/calendar'

/** 옮긴 뒤의 시작·종료(ISO UTC) */
export interface MovedRange {
  startsAt: string
  endsAt: string
}

/**
 * 시간 그리드에서 끈 세로 거리(px) → 옮길 분 — 30분 칸 단위로 반올림한다(만들기 끌기와 같은 30분 칸).
 * 절대 위치가 아니라 「얼마나 옮겼나」로 계산해, 10:15 같은 칸에 안 맞는 일정도 원래 분을 지킨 채 30분씩 움직인다.
 */
export function snappedMinuteDelta(deltaY: number): number {
  // 위아래를 같게 반올림한다 — Math.round 는 -0.5 를 0 으로 올려 위로 반 칸 끌면 움직이지 않았다(아래로는 한 칸).
  // -0 을 0 으로 — 같은 자리 판정(=== 0)이 흔들리지 않게.
  return Math.sign(deltaY) * Math.round(Math.abs(deltaY) / DRAG_SLOT_PX) * DRAG_SLOT_MINUTES || 0
}

/** 같은 길이를 지킨 채 시작을 새 시각으로 옮긴 범위 — 길이는 밀리초로 그대로 둔다. */
function withSameLength(event: Pick<CalendarEvent, 'startsAt' | 'endsAt'>, newStart: Date): MovedRange {
  const length = new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()
  return { startsAt: newStart.toISOString(), endsAt: new Date(newStart.getTime() + length).toISOString() }
}

/**
 * 주·일 보기 시간 그리드에서 타임드 일정을 옮긴다 — 잡은 날 열(fromDay)에서 놓은 날 열(toDay)로 날짜만큼,
 * 끈 세로 거리만큼(30분 칸 반올림) 시작을 옮기고 길이는 그대로 둔다. 여러 날에 걸친 일정의 둘째 날 조각을 잡아도
 * 「잡은 날 → 놓은 날」 차이만큼 옮겨 전체가 함께 움직인다. 날짜는 벽시계 기준(addDays)으로 더해 서머타임 날에도 시각이 지켜진다.
 * 그 날 안에서 시작한 일정은 시작이 놓은 날 0:00~23:30 안에 머물게 자른다(그리드 밖으로 끌어도 다른 날로 넘어가지 않게).
 * 제자리면 null — 저장하지 않는다.
 */
export function moveTimedInGrid(
  event: Pick<CalendarEvent, 'startsAt' | 'endsAt'>,
  fromDay: Date,
  toDay: Date,
  deltaY: number,
): MovedRange | null {
  const dayDelta = differenceInCalendarDays(toDay, fromDay)
  const start = new Date(event.startsAt)
  // 날짜만 옮긴 자리 — 세로로 움직이지 않았으면 그대로 이 시각이다.
  const sameTime = addDays(start, dayDelta)
  const next = new Date(sameTime)
  // 벽시계 분으로 더한다(setMinutes) — 밀리초로 더하면 서머타임 바뀌는 날 한 시간 어긋난다.
  next.setMinutes(next.getMinutes() + snappedMinuteDelta(deltaY))
  // 잡은 날 안에서 시작한 일정만 자른다 — 앞날에서 이어진 조각을 잡았을 때는 시작이 원래 그 날 밖이다.
  // 마지막 칸(23:30) 뒤에서 시작한 일정(23:45 등)은 원래 시각까지는 허용한다 — 옆 날로만 끌었는데 23:30 으로 당겨지지 않게.
  if (differenceInCalendarDays(start, fromDay) === 0) {
    const dayStart = startOfDay(toDay)
    const lastSlot = new Date(dayStart)
    lastSlot.setMinutes(24 * 60 - DRAG_SLOT_MINUTES)
    const latest = sameTime > lastSlot ? sameTime : lastSlot
    if (next < dayStart) next.setTime(dayStart.getTime())
    if (next > latest) next.setTime(latest.getTime())
  }
  if (next.getTime() === start.getTime()) return null
  return withSameLength(event, next)
}

/** 로컬 날짜(자정 Date) → 그 날 로컬 자정의 ISO — 일정 창이 종일 일정을 저장하는 표현(toEventRequest)과 같다. */
function localMidnightIso(day: Date): string {
  return startOfDay(day).toISOString()
}

/**
 * 날짜 칸(월 보기 칸, 주·일 보기 종일 줄)으로 일정을 옮긴다 — 잡은 칸(fromDay)에서 놓은 칸(toDay)까지의 날짜 차이만큼.
 * - 종일 일정: 의도한 날짜(allDayLocalDate)를 기준으로 날짜 수를 지켜 옮기고, 일정 창처럼 로컬 자정으로 저장한다.
 *   길이 0 으로 저장된 종일 일정(종료 ≤ 시작)은 하루 일정으로 본다(allDayFormRange 와 같은 규칙).
 * - 타임드 일정(월 보기): 날짜만 바꾸고 시각·길이는 그대로 둔다.
 * 제자리면 null.
 */
export function moveToDay(
  event: Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'allDay'>,
  fromDay: Date,
  toDay: Date,
): MovedRange | null {
  const dayDelta = differenceInCalendarDays(toDay, fromDay)
  if (dayDelta === 0) return null
  if (!event.allDay) return withSameLength(event, addDays(new Date(event.startsAt), dayDelta))
  const startDate = allDayLocalDate(event.startsAt)
  const days = Math.max(differenceInCalendarDays(allDayLocalDate(event.endsAt), startDate), 1)
  const newStart = addDays(startDate, dayDelta)
  return { startsAt: localMidnightIso(newStart), endsAt: localMidnightIso(addDays(newStart, days)) }
}

/**
 * 끌어 옮길 수 있는 일정인가 — 일정 창의 편집 가능 판정(eventEditability)과 같은 규칙을 목록 데이터로 본다.
 * 내 캘린더 목록에 있고(초대받은 남의 일정이 아님) 그 캘린더가 읽기 전용(M365 동기화)이 아닐 때만.
 * 캘린더 목록을 불러오기 전엔 판단할 수 없어 옮기지 못하게 둔다. 주최자 여부(myRole)는 상세에만 있어 여기서 보지 않는다 —
 * 그래도 걸리면 서버가 거절하고 오류 토스트가 뜬다.
 */
export function canMoveEvent(
  event: Pick<CalendarEvent, 'calendarId'>,
  calendars: Pick<Calendar, 'id' | 'isReadOnly'>[],
): boolean {
  const cal = calendars.find((c) => c.id === event.calendarId)
  return cal != null && !cal.isReadOnly
}

/**
 * 옮긴 일정의 저장 요청 바디 — 일정 창(EventDialog)이 목록 일정으로 프리필해 보내는 수정 바디와 같은 필드를 그대로 싣고 시각만 바꾼다.
 * 참석자(attendeeUserIds)는 수정에서 별도 API 라 싣지 않고, 태그(tagIds)는 생략해 서버가 건드리지 않게 한다.
 * 반복 규칙은 받은 문자열 그대로 보낸다(폼으로 풀었다 다시 만들면 여러 요일 등이 빠질 수 있다).
 */
export function moveRequestBody(event: CalendarEvent, range: MovedRange): CalendarEventRequest {
  return {
    title: event.title,
    description: event.description,
    startsAt: range.startsAt,
    endsAt: range.endsAt,
    allDay: event.allDay,
    location: event.location,
    color: event.color,
    reminderMinutes: event.reminderMinutes,
    recurrenceRule: event.recurrenceRule,
    calendarId: event.calendarId,
  }
}

/** 옮기는 중 미리보기용 — 일정의 시작·종료만 바꾼 사본(뷰가 같은 배치 함수로 놓일 자리를 그린다). */
export function withRange<T extends Pick<CalendarEvent, 'startsAt' | 'endsAt'>>(event: T, range: MovedRange): T {
  return { ...event, startsAt: range.startsAt, endsAt: range.endsAt }
}
