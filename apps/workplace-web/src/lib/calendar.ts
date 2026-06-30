import {
  addDays, eachDayOfInterval, endOfDay, endOfMonth, format,
  startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'

import type { Calendar, CalendarEvent, CalendarViewType, IssueDueMarker } from '../types/calendar'

// 월 그리드: 해당 월을 포함하는 일요일 시작 6주(42칸).
export function monthMatrix(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 })
  return Array.from({ length: 42 }, (_, i) => addDays(first, i))
}

// 해당 주(일요일 시작) 7일.
export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor, { weekStartsOn: 0 })
  return eachDayOfInterval({ start: first, end: addDays(first, 6) })
}

// 뷰별 서버 조회 범위(ISO). 겹침 쿼리에 사용.
export function visibleRange(view: CalendarViewType, anchor: Date): { from: string; to: string } {
  let start: Date
  let end: Date
  if (view === 'month') {
    start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 0 })
    end = addDays(start, 42)
  } else if (view === 'week' || view === 'agenda') {
    start = startOfWeek(anchor, { weekStartsOn: 0 })
    end = view === 'agenda' ? addDays(start, 30) : addDays(start, 7)
  } else {
    start = startOfDay(anchor)
    end = addDays(start, 1)
  }
  return { from: start.toISOString(), to: end.toISOString() }
}

// 특정 날짜와 겹치는 일정.
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)
  return events.filter((e) => {
    const s = new Date(e.startsAt)
    const en = new Date(e.endsAt)
    return s <= dayEnd && en > dayStart
  })
}

// 해당 날짜(yyyy-MM-dd)에 마감인 이슈 마커. dueDate 는 날짜 단위라 시각 비교 없이 키 매칭.
export function issueDuesOnDay(dues: IssueDueMarker[], day: Date): IssueDueMarker[] {
  const key = format(day, 'yyyy-MM-dd')
  return dues.filter((d) => d.dueDate.slice(0, 10) === key)
}

// 시간축(0~23시) 슬롯.
export const HOURS = Array.from({ length: 24 }, (_, h) => h)

// ISO instant(UTC 'Z' 또는 오프셋 포함) → datetime-local 표시 문자열 'YYYY-MM-DDTHH:mm'.
// 반드시 브라우저 로컬 타임존으로 변환한다 — 오프셋을 무시하고 iso.slice(0,16) 하면
// 백엔드가 UTC('06:00Z')로 저장한 시각이 KST 사용자에게 9시간 이른 시각으로 표시된다(일정 카드 06시 버그).
// EventDialog 의 ISO↔datetime-local 변환과 동일 로직. null/빈/파싱불가 입력은 '' 반환.
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// 시:분 표기. null/빈 문자열 입력 시 '-' 반환.
export function hhmm(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export { addDays, endOfMonth, startOfMonth }

// 사이드바 표시 토글 상태.
// hiddenCalendarIds: 명시적으로 숨긴 캘린더(목록에 없으면 표시 = 신규 캘린더 자동 표시).
// invited: 내 캘린더가 아닌 '초대받은 일정' 표시 여부. issueDues: 이슈 마감 오버레이.
export interface CalendarLayers {
  hiddenCalendarIds: number[]
  issueDues: boolean
  invited: boolean
}

const LAYERS_KEY = 'calendar.layers'
const DEFAULT_LAYERS: CalendarLayers = { hiddenCalendarIds: [], issueDues: true, invited: true }

export function loadLayers(): CalendarLayers {
  try {
    const raw = localStorage.getItem(LAYERS_KEY)
    if (!raw) return { ...DEFAULT_LAYERS, hiddenCalendarIds: [] }
    const p = JSON.parse(raw) as Partial<CalendarLayers>
    return {
      hiddenCalendarIds: Array.isArray(p.hiddenCalendarIds) ? p.hiddenCalendarIds : [],
      issueDues: p.issueDues ?? DEFAULT_LAYERS.issueDues,
      invited: p.invited ?? DEFAULT_LAYERS.invited,
    }
  } catch {
    return { ...DEFAULT_LAYERS, hiddenCalendarIds: [] }
  }
}

export function saveLayers(layers: CalendarLayers): void {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers))
  } catch {
    // 저장 불가 — 무시.
  }
}

// 캘린더 표시 여부 — hiddenCalendarIds 에 없으면 표시(기본 표시).
export function isCalendarVisible(layers: CalendarLayers, calendarId: number): boolean {
  return !layers.hiddenCalendarIds.includes(calendarId)
}

// 캘린더 표시 토글 — 새 layers 반환.
export function toggleCalendar(layers: CalendarLayers, calendarId: number): CalendarLayers {
  const hidden = isCalendarVisible(layers, calendarId)
  return {
    ...layers,
    hiddenCalendarIds: hidden
      ? [...layers.hiddenCalendarIds, calendarId]
      : layers.hiddenCalendarIds.filter((id) => id !== calendarId),
  }
}

// 공급자 raw 문자열 → 사이드바 pill 라벨. IMAP 은 일정 동기화를 안 하므로 현재는 M365 만 실제 등장.
export function providerLabel(provider: string | null | undefined): string {
  switch (provider) {
    case 'M365_GRAPH':
      return 'M365'
    case 'IMAP':
      return 'IMAP'
    default:
      return provider ?? ''
  }
}

// 사이드바 섹션 그룹핑 결과. accounts 는 계정 첫 등장 순서를 유지한다.
export interface CalendarSourceGroups {
  local: Calendar[]
  accounts: { email: string; provider: string | null; calendars: Calendar[] }[]
}

// accountEmail 기준으로 로컬/연동 캘린더를 분리·그룹핑. 입력 정렬(position,id)은 백엔드가 보장.
export function groupCalendarsBySource(calendars: Calendar[]): CalendarSourceGroups {
  const local: Calendar[] = []
  const accounts: CalendarSourceGroups['accounts'] = []
  const byEmail = new Map<string, CalendarSourceGroups['accounts'][number]>()
  for (const c of calendars) {
    if (!c.accountEmail) {
      local.push(c)
      continue
    }
    let group = byEmail.get(c.accountEmail)
    if (!group) {
      group = { email: c.accountEmail, provider: c.provider ?? null, calendars: [] }
      byEmail.set(c.accountEmail, group)
      accounts.push(group)
    }
    group.calendars.push(c)
  }
  return { local, accounts }
}
