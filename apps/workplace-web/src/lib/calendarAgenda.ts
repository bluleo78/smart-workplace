// 모바일 캘린더 일정 목록(WP-136)용 순수 로직 — 30일 청크 범위, 날짜별 묶음, 머리글 문자열.
// 컴포넌트(MobileAgendaView)·무한 로딩 훅과 분리해 vitest 로 단위 검증한다.
import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'

import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { allDayLocalDate } from './calendar'
import { formatLocalClockTime24 } from './formatters'

// 한 청크가 덮는 일수. 목록은 청크 단위로 아래로 이어 불러온다.
export const AGENDA_CHUNK_DAYS = 30

// 날짜 묶음 안의 한 행 — 일정(event) 또는 이슈 마감(due). 컴포넌트가 kind 로 분기해 렌더한다.
// continued: 목록 시작일 전에 시작해 시작일까지 이어지는 일정(어제 시작한 3일 컨퍼런스 등)을 시작일 묶음에 넣은 행 —
// 종일 그룹과 함께 맨 앞에 두고, 시간 칸에 끝("~10/15")을 보이며, 흐림·지금 선 계산에서는 뺀다(WP-136 A1).
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

// 이어지는 일정 행의 끝 표시 — "~10/15"(끝나는 날짜) 또는 그 날 안에 끝나면 "~09:00".
// 종일 끝은 배타적(다음 날 자정)이라 하루를 빼 실제 마지막 날을 보인다.
export function continuedEndLabel(event: CalendarEvent, day: Date): string {
  if (event.allDay) return `~${format(addDays(allDayLocalDate(event.endsAt), -1), 'M/d')}`
  const end = new Date(event.endsAt)
  return isSameDay(end, day) ? `~${formatLocalClockTime24(event.endsAt)}` : `~${format(end, 'M/d')}`
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
    push(key, new Date(`${key}T00:00:00`), { kind: 'due', marker })
  }

  // yyyy-MM-dd 는 사전순 = 날짜순.
  return [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((d) => ({ ...d, items: [...d.items].sort(compareItems) }))
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
