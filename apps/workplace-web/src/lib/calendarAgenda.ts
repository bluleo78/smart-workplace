// 모바일 캘린더 일정 목록(WP-136)용 순수 로직 — 30일 청크 범위, 날짜별 묶음, 머리글 문자열.
// 컴포넌트(MobileAgendaView)·무한 로딩 훅과 분리해 vitest 로 단위 검증한다.
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'

import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { allDayLocalDate } from './calendar'
import { formatLocalClockTime24 } from './formatters'

// 한 청크가 덮는 일수. 목록은 청크 단위로 아래로 이어 불러온다.
export const AGENDA_CHUNK_DAYS = 30

// 날짜 묶음 안의 한 행 — 일정(event) 또는 이슈 마감(due). 컴포넌트가 kind 로 분기해 렌더한다.
// continued: 목록 시작일 전에 시작해 시작일까지 이어지는 일정(어제 시작한 3일 컨퍼런스 등)을 시작일 묶음에 넣은 행 —
// 종일 그룹과 함께 맨 앞에 두고, 시간 칸에 끝("~10/15")을 보이며, 흐림·지금 선 계산에서는 뺀다.
export type AgendaItem =
  | { kind: 'event'; event: CalendarEvent; continued?: boolean }
  | { kind: 'due'; marker: IssueDueMarker }

// 하루치 묶음. day = 로컬 자정, key = 'yyyy-MM-dd'(React key·IntersectionObserver 식별용).
export interface AgendaDay {
  day: Date
  key: string
  items: AgendaItem[]
}

// 일정의 표시·정렬 기준 Date. 종일은 instant 가 아니라 복원한 캘린더 날짜(로컬 자정)를 쓴다
// — 동기화 UTC 자정 종일이 타임존에 따라 하루 밀려 표시되던 문제를 막고 MonthView·TimeGrid 와 통일.
// (데스크톱 AgendaView 와 공유한다.)
export function eventDate(e: CalendarEvent): Date {
  return e.allDay ? allDayLocalDate(e.startsAt) : new Date(e.startsAt)
}

// 청크 index 의 서버 조회 범위(ISO). startOfDay(start) + 30*index 일부터 30일.
// addDays 는 로컬 달력 기준이라 DST 경계에서도 청크가 빈틈·겹침 없이 이어진다(앞 청크 to == 다음 청크 from).
export function agendaChunkRange(start: Date, index: number): { from: string; to: string } {
  const from = addDays(startOfDay(start), AGENDA_CHUNK_DAYS * index)
  return { from: from.toISOString(), to: addDays(from, AGENDA_CHUNK_DAYS).toISOString() }
}

/**
 * 불러온 범위 안의 이슈 마감만 남긴다 — loadedTo 는 마지막 청크의 to(다음 날 자정, 배타).
 * 마감 조회는 to 를 날짜로 바꿔 dueTo(포함)로 보내므로 그 날 마감이 섞여 온다. 남겨 두면 마지막 청크 끝 다음 날에
 * 일정 없이 마감만 보이게 되고(상한에 닿으면 영구히), 다음 청크를 불러오면 같은 날 묶음이 뒤늦게 채워진다.
 */
export function duesWithinLoaded(dues: IssueDueMarker[], loadedTo: string): IssueDueMarker[] {
  const endKey = format(new Date(loadedTo), 'yyyy-MM-dd')
  return dues.filter((m) => m.dueDate.slice(0, 10) < endKey)
}

// 정렬 그룹 순위 — 종일 일정·이어지는 일정(0) → 이슈 마감(1) → 시간 지정 일정(2).
function rank(item: AgendaItem): number {
  if (item.kind === 'due') return 1
  return item.event.allDay || item.continued ? 0 : 2
}

// 그 날 시간 순서(흐림·지금 선)에 참여하는 행 — 그 날 시작한 시간 지정 일정만. 종일·마감·이어지는 일정은 빠진다.
function isTimedOnDay(item: AgendaItem): item is Extract<AgendaItem, { kind: 'event' }> {
  return item.kind === 'event' && !item.event.allDay && !item.continued
}

// 일정이 day(로컬 자정) 이후까지 이어지는지 — 시작일 전에 시작한 일정을 시작일 묶음에 넣을지 판정한다.
// 종일은 끝(배타적 다음 날 자정)을 eventsOnDay 와 같이 복원 날짜로 비교하고, 시간 지정은 시각으로 비교한다.
// 둘 다 끝이 정확히 day 자정이면 day 에는 걸치지 않는다(전날에 끝난 일정).
function continuesInto(event: CalendarEvent, day: Date): boolean {
  const end = event.allDay ? allDayLocalDate(event.endsAt) : new Date(event.endsAt)
  return end.getTime() > day.getTime()
}

// 시간 일정의 실제 마지막 날 — 끝이 정확히 로컬 자정(00:00)이면 그 자정은 "다음 날의 시작"이 아니라 "그 전날의 끝"이라
// 전날로 본다(22:00~다음 날 00:00 을 여러 날 일정처럼 보이지 않게). 길이 0 일정(시작 == 끝)은 그대로 둔다.
function timedLastDay(event: CalendarEvent): { day: Date; endsAtMidnight: boolean } {
  const end = new Date(event.endsAt)
  const endDay = startOfDay(end)
  const endsAtMidnight = end.getTime() === endDay.getTime() && end.getTime() > new Date(event.startsAt).getTime()
  return { day: endsAtMidnight ? addDays(endDay, -1) : endDay, endsAtMidnight }
}

// 일정 행 시간 칸 두 줄(시작·끝) — 목록 시작 행과 이어지는(continued) 행이 같은 규칙으로 끝을 보이게 한 곳에 모은다.
// - 종일: 첫 줄 "종일". 하루짜리는 끝 줄 없음, 여러 날이면 "~M/d"(배타적 끝 −1일 = 실제 마지막 날).
// - 시간 일정: 첫 줄은 시작 시각(이어지는 행이면 시작 날짜 M/d). 끝 줄은 마지막 날이 기준일(시작일 또는 이어지는 날)과 같으면
//   시각(자정에 끝나면 "24:00" — 00:00 은 시작보다 이른 시각처럼 읽힌다), 다르면 "~M/d"(시각만 쓰면 시작보다 이르게 읽힌다).
//   이어지는 행은 날짜가 아닌 끝 시각에도 "~" 를 붙인다("~09:00" — 첫 줄이 날짜라 "~" 없이는 범위로 읽히지 않는다).
// 끝 줄이 "~" 로 시작하면 화면에 범위 기호가 이미 있는 것이라, 호출부는 접근성용 숨김 구분자를 공백만 둔다.
export function agendaTimeLabels(event: CalendarEvent, continuedOn: Date | null): { start: string; end: string | null } {
  if (event.allDay) {
    const startDay = allDayLocalDate(event.startsAt)
    const lastDay = addDays(allDayLocalDate(event.endsAt), -1)
    const multiDay = lastDay.getTime() > startDay.getTime()
    // 이어지는 종일 행은 시작일 전에 시작했으니 언제나 여러 날이다.
    return { start: '종일', end: multiDay ? `~${format(lastDay, 'M/d')}` : null }
  }
  const { day: lastDay, endsAtMidnight } = timedLastDay(event)
  const refDay = continuedOn ?? new Date(event.startsAt)
  const start = continuedOn ? format(new Date(event.startsAt), 'M/d') : formatLocalClockTime24(event.startsAt)
  if (!isSameDay(lastDay, refDay)) return { start, end: `~${format(lastDay, 'M/d')}` }
  const time = endsAtMidnight ? '24:00' : formatLocalClockTime24(event.endsAt)
  return { start, end: continuedOn ? `~${time}` : time }
}

// 같은 날 안의 정렬: 종일·마감 먼저, 시간 지정은 시작 시각 오름차순. 동률은 제목 → id 로 안정화한다.
function compareItems(a: AgendaItem, b: AgendaItem): number {
  const r = rank(a) - rank(b)
  if (r !== 0) return r
  if (a.kind === 'event' && b.kind === 'event') {
    const t = new Date(a.event.startsAt).getTime() - new Date(b.event.startsAt).getTime()
    if (t !== 0 && rank(a) === 2) return t
    return a.event.title.localeCompare(b.event.title, 'ko') || a.event.id - b.event.id
  }
  if (a.kind === 'due' && b.kind === 'due') {
    return a.marker.projectKey.localeCompare(b.marker.projectKey) || a.marker.number - b.marker.number
  }
  return 0
}

// 일정·이슈 마감을 날짜별로 묶는다(날짜 오름차순, 일정 없는 날은 만들지 않는다).
// - 묶음 날짜: 일정은 eventDate(종일 복원 날짜), 마감은 dueDate 의 날짜 — 여러 날 일정은 시작일에만 나온다.
// - 중복 제거: 청크 경계에 걸친 일정이 인접 청크 응답에 모두 오므로 id+occurrenceDate(마감은 issueId)로 한 번만 남긴다.
// - opts.from: 청크 쿼리는 겹침 쿼리라 시작 전에 시작한 일정이 섞여 오므로 from 날짜 이전 묶음은 버린다(시각이 아니라 날짜 기준).
//   단 from 날짜까지 이어지는 일정(진행 중인 여러 날 일정)은 버리지 않고 from 묶음에 continued 로 넣는다 — 안 그러면
//   어제 시작한 휴가·미니 달력으로 고른 날을 덮는 일정이 목록 어디에도 안 보인다. 뒤 청크는 from 보다 뒤라 이 규칙과 무관하고,
//   경계에 걸친 일정은 위 중복 제거가 한 번만 남긴다.
export function groupAgendaDays(
  events: CalendarEvent[],
  dues: IssueDueMarker[],
  opts?: { from?: Date },
): AgendaDay[] {
  const fromDay = opts?.from ? startOfDay(opts.from) : null
  const minKey = fromDay ? format(fromDay, 'yyyy-MM-dd') : null
  const byKey = new Map<string, AgendaDay>()
  const seen = new Set<string>()

  const push = (key: string, day: Date, item: AgendaItem) => {
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { day, key, items: [] }
      byKey.set(key, bucket)
    }
    bucket.items.push(item)
  }

  for (const event of events) {
    const id = `e-${event.id}-${event.occurrenceDate ?? 'single'}`
    if (seen.has(id)) continue
    seen.add(id)
    const day = startOfDay(eventDate(event))
    const key = format(day, 'yyyy-MM-dd')
    if (fromDay && minKey && key < minKey) {
      if (continuesInto(event, fromDay)) push(minKey, fromDay, { kind: 'event', event, continued: true })
      continue
    }
    push(key, day, { kind: 'event', event })
  }
  for (const marker of dues) {
    const id = `d-${marker.issueId}`
    if (seen.has(id)) continue
    seen.add(id)
    const key = marker.dueDate.slice(0, 10)
    if (minKey && key < minKey) continue
    push(key, parseISO(key), { kind: 'due', marker })
  }

  // yyyy-MM-dd 는 사전순 = 날짜순.
  return [...byKey.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((d) => ({ ...d, items: [...d.items].sort(compareItems) }))
}

// 청크별 불러오기 진행 요약 — 날짜 묶음을 청크(시작일부터 30일씩)에 나눠 담아 센다.
// - loaded[i]: 일정 청크 i 조회 성공. 앞에서부터 연속으로 성공한 청크 수(loadedChunks)까지만 AI 컨텍스트 범위·일정 수에 넣는다 —
//   뒤 청크가 성공해도 앞 청크가 로딩 중·실패면 그 사이가 비어 "불러오지 않은 기간"을 0건으로 알리게 된다.
// - settled[i]: 일정·(켜져 있으면) 마감 청크 i 모두 성공 — 행이 더 늘지 않는 확정 상태.
// - trailingEmpty: 끝에서부터 연속된 "확정됐는데 행이 하나도 없는" 청크 수. 일정이 드문 사용자의 자동 연쇄 불러오기를 끊는 기준이다.
//   묶음(days)으로 세므로 캘린더 필터·중복 제거·이어지는 일정(시작일 묶음 = 첫 청크) 결과가 그대로 반영된다.
export function agendaProgress(
  days: AgendaDay[],
  start: Date,
  loaded: boolean[],
  settled: boolean[],
): { loadedChunks: number; eventCount: number; trailingEmpty: number } {
  const firstMissing = loaded.indexOf(false)
  const loadedChunks = firstMissing === -1 ? loaded.length : firstMissing
  const rowsPerChunk = settled.map(() => 0)
  let eventCount = 0
  const startDay = startOfDay(start)
  for (const d of days) {
    const i = Math.floor(differenceInCalendarDays(d.day, startDay) / AGENDA_CHUNK_DAYS)
    if (i < rowsPerChunk.length) rowsPerChunk[i] += d.items.length
    if (i < loadedChunks) eventCount += d.items.filter((it) => it.kind === 'event').length
  }
  let trailingEmpty = 0
  for (let i = settled.length - 1; i >= 0 && settled[i] && rowsPerChunk[i] === 0; i--) trailingEmpty++
  return { loadedChunks, eventCount, trailingEmpty }
}

// 날짜 머리글 — 오늘이면 "오늘 · 10월 13일 (화)", 아니면 "10월 14일 (수)".
export function agendaTitle(day: Date, today: Date): string {
  const label = format(day, 'M월 d일 (EEE)', { locale: ko })
  return isSameDay(day, today) ? `오늘 · ${label}` : label
}

// 모바일 헤더 월 라벨 — 올해면 "10월", 다른 해면 "2027년 10월".
export function headerMonthLabel(d: Date, today: Date): string {
  return d.getFullYear() === today.getFullYear()
    ? format(d, 'M월', { locale: ko })
    : format(d, 'yyyy년 M월', { locale: ko })
}

// 오늘 묶음의 "지금" 표시 — 날짜 묶음 하나(items, 정렬 끝난 상태)와 현재 시각으로 계산한다.
// - past[i]: 끝난 시간 지정 일정(endsAt <= now)이면 true — 흐리게 그린다. 종일·이슈 마감·이어지는 일정(continued)은 흐리게 하지 않는다.
// - nowIndex: 빨간 지금 선을 그릴 위치(그 인덱스 행 바로 앞). 아직 안 끝난 첫 시간 지정 일정 앞이고,
//   시간 지정 일정이 모두 끝났으면 묶음 끝(items.length), 시간 지정 일정이 하나도 없으면 -1(선 없음 — 기준 행이 없어 의미가 없다).
// 오늘이 아닌 묶음에는 호출하지 않는다(과거·미래 날짜는 흐림·선 없음).
export function agendaNowState(items: AgendaItem[], now: Date): { nowIndex: number; past: boolean[] } {
  const nowMs = now.getTime()
  // 이어지는 일정은 맨 앞(종일 그룹)에 있어 시간 순서에 넣으면 지금 선이 묶음 맨 위로 올라간다 — 종일처럼 뺀다.
  const past = items.map((it) => isTimedOnDay(it) && new Date(it.event.endsAt).getTime() <= nowMs)
  const hasTimed = items.some(isTimedOnDay)
  if (!hasTimed) return { nowIndex: -1, past }
  const next = items.findIndex((it, i) => isTimedOnDay(it) && !past[i])
  return { nowIndex: next === -1 ? items.length : next, past }
}
