// 모바일 캘린더 일정 목록(WP-136)용 순수 로직 — 30일 청크 범위, 날짜별 묶음, 머리글 문자열.
// 컴포넌트(MobileAgendaView)·무한 로딩 훅과 분리해 vitest 로 단위 검증한다.
import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'

import type { CalendarEvent, IssueDueMarker } from '@/types/calendar'

import { allDayLocalDate } from './calendar'

// 한 청크가 덮는 일수. 목록은 청크 단위로 아래로 이어 불러온다.
export const AGENDA_CHUNK_DAYS = 30

// 날짜 묶음 안의 한 행 — 일정(event) 또는 이슈 마감(due). 컴포넌트가 kind 로 분기해 렌더한다.
export type AgendaItem =
  | { kind: 'event'; event: CalendarEvent }
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

// 정렬 그룹 순위 — 종일 일정(0) → 이슈 마감(1) → 시간 지정 일정(2).
function rank(item: AgendaItem): number {
  if (item.kind === 'due') return 1
  return item.event.allDay ? 0 : 2
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
export function groupAgendaDays(
  events: CalendarEvent[],
  dues: IssueDueMarker[],
  opts?: { from?: Date },
): AgendaDay[] {
  const minKey = opts?.from ? format(startOfDay(opts.from), 'yyyy-MM-dd') : null
  const byKey = new Map<string, AgendaDay>()
  const seen = new Set<string>()

  const push = (key: string, day: Date, item: AgendaItem) => {
    if (minKey && key < minKey) return
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
    push(format(day, 'yyyy-MM-dd'), day, { kind: 'event', event })
  }
  for (const marker of dues) {
    const id = `d-${marker.issueId}`
    if (seen.has(id)) continue
    seen.add(id)
    const key = marker.dueDate.slice(0, 10)
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
