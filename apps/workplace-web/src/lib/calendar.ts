import {
  addDays, eachDayOfInterval, endOfDay, endOfMonth, format,
  startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'

import type { Calendar, CalendarEvent, CalendarViewType, IssueDueMarker } from '../types/calendar'
import { type StorageOwner, userScopedKey } from './userScopedKey'

// 보기 → 사용자에게 보이는 탭 이름. 캘린더 헤더의 뷰 전환 탭과 AI 화면 컨텍스트(WP-54, '<이름> 보기')가 공유한다.
export const CALENDAR_VIEW_LABEL: Record<CalendarViewType, string> = {
  month: '월',
  week: '주',
  day: '일',
  agenda: '목록',
}

// 뷰 전환 탭 목록(표시 순서 = CALENDAR_VIEW_LABEL 키 순서).
export const CALENDAR_VIEWS = (Object.keys(CALENDAR_VIEW_LABEL) as CalendarViewType[]).map((key) => ({
  key,
  label: CALENDAR_VIEW_LABEL[key],
}))

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

// 종일 일정의 "의도한 캘린더 날짜"를 타임존 독립적으로 복원해 로컬 자정 Date 로 반환한다.
// 종일 저장 표현이 두 갈래다: 동기화(M365)는 UTC 자정 [D 00:00Z, D+1 00:00Z), 로컬 생성은
// 현지 자정 instant(KST 는 전날 15:00Z). 둘 다 어떤 UTC 자정에서 ±12h 안에 있으므로, 백엔드
// CalendarEventService.toGraphDateTime 과 동일하게 instant 에 +12h 를 더해 가장 가까운 UTC 자정으로
// 반올림하면 의도 날짜가 복원된다. instant 비교를 쓰면 UTC 자정 종일이 KST 에서 +9h 밀려 배타적
// end(D+1 00:00Z = D+1 09:00 KST)가 다음 날 셀에 걸려 양일에 찍힌다(현충일 6/6·6/7 버그).
// 종일 일정의 날짜 표시·정렬·셀 매칭은 모두 이 헬퍼로 통일한다(MonthView·TimeGrid·AgendaView).
export function allDayLocalDate(iso: string): Date {
  const shifted = new Date(new Date(iso).getTime() + 12 * 60 * 60 * 1000)
  return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
}

// yyyymmdd 정수 키 — 날짜 비교용(시각 시프트 차단).
function dateKey(day: Date): number {
  return day.getFullYear() * 10000 + (day.getMonth() + 1) * 100 + day.getDate()
}

// 특정 날짜와 겹치는 일정.
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)
  const cellKey = dateKey(day)
  return events.filter((e) => {
    // 종일은 시각이 아니라 캘린더 날짜로 half-open [start,end) 비교(배타적 end 날짜 제외).
    if (e.allDay) {
      return dateKey(allDayLocalDate(e.startsAt)) <= cellKey && cellKey < dateKey(allDayLocalDate(e.endsAt))
    }
    const s = new Date(e.startsAt)
    const en = new Date(e.endsAt)
    return s <= dayEnd && en > dayStart
  })
}

// 시간 그리드(주·일 보기) 한 칸 = 1시간 높이(px).
export const HOUR_SLOT_PX = 48

// 시간 그리드에서 타임드 일정 블록의 top·height(px) — 그 날에 걸친 구간만 그린다(WP-539). 자정을 넘기는 일정은 시작한 날엔
// 시작~24시, 이어지는 날엔 0시~종료로 잘린다. 시·분만 보면 두 날 모두 시작 시각 위치의 최소 높이 조각이 됐다. 최소 16px.
export function timedEventBox(event: CalendarEvent, day: Date): { top: number; height: number } {
  const dayStart = startOfDay(day)
  const nextDay = addDays(dayStart, 1)
  const start = new Date(event.startsAt)
  const end = new Date(event.endsAt)
  // 그날 안으로 자른 시작·종료의 「시각(시간 단위)」 — 하루를 넘어가면 0시·24시로.
  const startHour = start <= dayStart ? 0 : start.getHours() + start.getMinutes() / 60
  const endHour = end >= nextDay ? 24 : end.getHours() + end.getMinutes() / 60
  return {
    top: startHour * HOUR_SLOT_PX,
    height: Math.max((endHour - startHour) * HOUR_SLOT_PX, 16),
  }
}

// 해당 날짜(yyyy-MM-dd)에 마감인 이슈 마커. dueDate 는 날짜 단위라 시각 비교 없이 키 매칭.
export function issueDuesOnDay(dues: IssueDueMarker[], day: Date): IssueDueMarker[] {
  const key = format(day, 'yyyy-MM-dd')
  return dues.filter((d) => d.dueDate.slice(0, 10) === key)
}

// 시간 그리드 드래그로 고르는 단위(WP-949) — 30분. 한 시간 칸(HOUR_SLOT_PX)의 절반 높이다.
export const DRAG_SLOT_MINUTES = 30
const DRAG_SLOT_PX = (HOUR_SLOT_PX * DRAG_SLOT_MINUTES) / 60

/**
 * 시간 그리드에서 끈 구간(열 맨 위 기준 y px 두 점) → 그날의 시작·종료 시각(WP-949). 위아래 어느 쪽으로 끌어도 되고,
 * 두 점이 든 30분 칸을 모두 덮도록 시작은 내림·종료는 올림한다. 열 밖으로 끌면 그날 0시~24시 안으로 자른다 — 날짜를 넘기는
 * 드래그는 다루지 않는다(시작한 열의 날만).
 */
export function dragSlotRange(day: Date, y1: number, y2: number): { start: Date; end: Date } {
  const slots = (24 * 60) / DRAG_SLOT_MINUTES
  const clampSlot = (y: number) => Math.min(Math.max(Math.floor(y / DRAG_SLOT_PX), 0), slots - 1)
  const from = clampSlot(Math.min(y1, y2))
  const to = clampSlot(Math.max(y1, y2)) + 1
  // 벽시계 기준으로 더한다(setMinutes) — 밀리초로 더하면 서머타임 바뀌는 날 한 시간 어긋난다.
  const at = (slot: number) => {
    const d = startOfDay(day)
    d.setMinutes(slot * DRAG_SLOT_MINUTES)
    return d
  }
  return { start: at(from), end: at(to) }
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

/**
 * datetime-local 두 값의 순서가 뒤집혔는지(WP-727) — 둘 다 있고 종료가 시작과 같거나 앞서면 true. 같은 형식(YYYY-MM-DDTHH:mm)이라 문자열 비교가
 * 시각 순서와 같다. 일정 제안 카드가 승인 전에 막는 데 쓴다(서버도 「종료 시각은 시작 시각보다 뒤여야 합니다」로 거절한다).
 */
export function isLocalRangeReversed(startsAt: string, endsAt: string): boolean {
  return !!startsAt && !!endsAt && endsAt <= startsAt
}

/**
 * 일정 제안 카드의 읽기전용 시간 표시 — 'YYYY-MM-DD HH:mm ~ HH:mm'(종료 없으면 시작만).
 * UTC 로 저장된 제안 시각을 브라우저 로컬(KST)로 바꿔 보여 준다 — 확인 대기·확정 블록이 같은 규칙을 쓴다.
 */
export function proposalTimeRange(startsAt: string, endsAt: string | null | undefined): string {
  const start = isoToLocalInput(startsAt).replace('T', ' ')
  return endsAt ? `${start} ~ ${isoToLocalInput(endsAt).slice(11, 16)}` : start
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

// 표시 설정은 사용자·워크스페이스별로 저장한다(WP-701) — 같은 브라우저의 다음 사용자에게 앞 사용자의 숨김 설정이 남지 않게.
const LAYERS_BASE = 'calendar.layers'
const DEFAULT_LAYERS: CalendarLayers = { hiddenCalendarIds: [], issueDues: true, invited: true }

export function loadLayers(owner: StorageOwner): CalendarLayers {
  try {
    const raw = localStorage.getItem(userScopedKey(LAYERS_BASE, owner))
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

export function saveLayers(owner: StorageOwner, layers: CalendarLayers): void {
  try {
    localStorage.setItem(userScopedKey(LAYERS_BASE, owner), JSON.stringify(layers))
  } catch {
    // 저장 불가 — 무시.
  }
}

// 마지막으로 쓴 보기(WP-948) — 다시 들어오면 그 보기로 연다. 표시 설정처럼 사용자·워크스페이스별 localStorage 에 둔다.
// 데스크톱과 모바일은 기본 보기(월·목록)도 화면 폭도 달라 따로 기억한다 — 모바일에서 고른 목록이 데스크톱을 목록으로 열지 않게.
/** 마지막 보기 키 — `calendar.lastView.<desktop|mobile>` + 주인(사용자·워크스페이스). 읽기·쓰기가 같은 키를 쓰게 한 곳에서 만든다. */
function lastViewKey(owner: StorageOwner, mobile: boolean): string {
  return userScopedKey(`calendar.lastView.${mobile ? 'mobile' : 'desktop'}`, owner)
}

/** 저장된 마지막 보기. 없거나 알 수 없는 값이거나 저장소를 못 읽으면 null(호출자가 기본 보기를 쓴다). */
export function loadLastView(owner: StorageOwner, mobile: boolean): CalendarViewType | null {
  try {
    const raw = localStorage.getItem(lastViewKey(owner, mobile))
    return raw && Object.hasOwn(CALENDAR_VIEW_LABEL, raw) ? (raw as CalendarViewType) : null
  } catch {
    return null
  }
}

/** 사용자가 고른 보기를 마지막 보기로 저장한다. 저장소를 못 쓰면 조용히 넘어간다(다음에 기본 보기로 열린다). */
export function saveLastView(owner: StorageOwner, mobile: boolean, view: CalendarViewType): void {
  try {
    localStorage.setItem(lastViewKey(owner, mobile), view)
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

/**
 * 일정 표시 여부 — 사이드바 표시 토글을 존중한다.
 * 내 캘린더의 일정이면 캘린더별 토글을, 아니면(초대받아 보이는 다른 사람 캘린더 일정) '초대받은 일정' 토글을 따른다.
 */
export function isEventVisible(
  layers: CalendarLayers,
  myCalendarIds: ReadonlySet<number>,
  event: Pick<CalendarEvent, 'calendarId'>,
): boolean {
  return myCalendarIds.has(event.calendarId) ? isCalendarVisible(layers, event.calendarId) : layers.invited
}

/** 내 캘린더가 아닌(초대받아 보이는) 일정의 캘린더 라벨 — 사이드바 범례 「초대받은 일정」과 같은 말. */
export const INVITED_CALENDAR_LABEL = '초대받은 일정'

/**
 * 일정에 붙일 캘린더 이름(WP-604). 내 캘린더 일정이면 그 캘린더 이름, 초대받아 보이는 다른 사람 캘린더 일정이면 「초대받은 일정」 —
 * 주최자 캘린더 이름(「기본」 등)이 그대로 나오면 내 캘린더처럼 보였다. 내 캘린더 목록을 아직 못 받았으면(null) 판정할 수 없어 이름을 비운다 —
 * 일정의 이름을 먼저 보였다가 바꾸면 초대 일정에 주최자 캘린더 이름이 잠깐 비친다.
 */
export function eventCalendarLabel(
  event: Pick<CalendarEvent, 'calendarId' | 'calendarName'>,
  myCalendarIds: ReadonlySet<number> | null,
): string | null {
  if (myCalendarIds == null) return null
  return myCalendarIds.has(event.calendarId) ? event.calendarName : INVITED_CALENDAR_LABEL
}

/**
 * 미니 캘린더에 점을 찍을 날 — month 의 6주 그리드 중 보이는 일정이 있거나, 마감 레이어가 켜져 있고 마감 이슈가 있는 날.
 * 표시 토글을 끈 캘린더·레이어는 점에서도 빠져야 그리드와 어긋나지 않는다.
 */
export function markedDays(
  month: Date,
  events: CalendarEvent[],
  dues: IssueDueMarker[],
  showIssueDues: boolean,
  isVisible: (e: CalendarEvent) => boolean,
): Date[] {
  const visible = events.filter(isVisible)
  return monthMatrix(month).filter(
    (day) => eventsOnDay(visible, day).length > 0 || (showIssueDues && issueDuesOnDay(dues, day).length > 0),
  )
}

// 내가 이 일정의 주최자가 아닌지(WP-200) — 상세(GET /events/{id}) 응답 기준. 백엔드 수정·삭제 가드(requireOrganizer)와 같은 규칙:
// 내 역할이 ATTENDEE 이거나, 주최자가 나 아닌 다른 내부 사용자면 true. 외부 이메일 주최자 + 내 행 없음은 별칭으로 온 내 미팅일 수 있어 false.
// 목록 응답(attendees 없음)이나 참석자 행이 없는 옛 일정도 false.
export function isNotEventOrganizer(
  event: Pick<CalendarEvent, 'myRole' | 'attendees'> | null | undefined,
): boolean {
  if (!event) return false
  if (event.myRole === 'ATTENDEE') return true
  return event.myRole !== 'ORGANIZER' &&
    (event.attendees?.some((a) => a.role === 'ORGANIZER' && a.userId != null) ?? false)
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

/**
 * 캘린더 화면에서 일정을 칠할 색 키(WP-952) — 일정에 직접 고른 색 › 첫 번째 태그 색 › 캘린더 색. 서버 effectiveColor 는
 * 「직접 고른 색 › 캘린더 색」이라, 직접 고른 색(color)이 없을 때만 첫 태그 색을 끼워 넣는다. 태그는 칩과 같은 순서(이름순)라
 * 「첫 태그」는 일정에 처음 보이는 태그다. 태그는 사람마다 따로라 같은 일정도 보는 사람에 따라 색이 다를 수 있다.
 */
export function eventDisplayColor(e: Pick<CalendarEvent, 'color' | 'tags' | 'effectiveColor'>): string {
  if (e.color) return e.effectiveColor
  return e.tags?.[0]?.color ?? e.effectiveColor
}

/** 첫 태그 말고 남은 태그 색(겹치지 않게, 블록 색과 같은 색은 뺀다) — 일정 블록 옆 작은 점으로 보인다(WP-952). */
export function extraTagColors(e: Pick<CalendarEvent, 'color' | 'tags' | 'effectiveColor'>): string[] {
  const main = eventDisplayColor(e)
  const out: string[] = []
  for (const t of e.tags?.slice(1) ?? []) {
    if (t.color && t.color !== main && !out.includes(t.color)) out.push(t.color)
  }
  return out
}
