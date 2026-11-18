// 일정에서 만드는 회의록 노트의 순수 함수(WP-1702) — 제목·틀(미리보기 줄·마크다운)·위치 기억·위치 해석.
// 「회의록 만들기」 창(MeetingNoteCreateDialog)과 새 일정 저장 흐름(CalendarPage)이 같은 규칙을 쓰도록 여기 모은다.
import { format, isSameDay } from 'date-fns'

import type { WikiSpace } from '@/types/wiki'

import { isEditRole } from './collab/collabStatus'
import { formatLocalDateWithWeekday } from './formatters'
import { readStored, writeStored } from './storageWithFallback'
import { type StorageOwner, userScopedKey } from './userScopedKey'
import { WIKI_TITLE_MAX } from './wikiLimits'

/** 회의록을 만들 자리 — 공간과 상위 노트(null 이면 공간 최상위). */
export interface MeetingNoteLocation {
  spaceId: number
  parentId: number | null
}

/**
 * 해석한 자리와 그 출처 — saved: 지난번 회의록 위치, mine: 내 공간(기본), fallback: 내 공간이 없어 고른 쓸 수 있는 첫 공간.
 * 창이 위치 줄 아래 작은 글씨(「지난번 회의록 위치」·「내 공간」)를 고르는 데 쓴다.
 */
export interface ResolvedMeetingNoteLocation extends MeetingNoteLocation {
  source: 'saved' | 'mine' | 'fallback'
}

/** 새 일정에서 저장 전 정해 둔 회의록 — 일정을 저장한 뒤 이 값으로 노트를 만들어 잇는다. markdown 은 저장 순간의 폼 값으로 만든 틀. */
export interface MeetingNoteDraft extends MeetingNoteLocation {
  title: string
  markdown: string
}

/** 틀 미리보기 한 줄 — value 가 없으면 머리말(안건·결정·할 일)만. */
export interface MeetingNoteTemplateLine {
  label: string
  value?: string
}

/** 틀 — 창의 미리보기 줄과 노트 본문 마크다운. 같은 근원에서 만들어 둘이 어긋나지 않게 한다. */
export interface MeetingNoteTemplate {
  lines: MeetingNoteTemplateLine[]
  markdown: string
}

/** 본문 머리말 — 회의록이 늘 갖는 세 칸. */
const SECTIONS = ['안건', '결정', '할 일'] as const

/**
 * 회의록 제목 — `11/18 주간 기획 회의 회의록`. 월·일은 앞자리 0 없이, 일정(반복이면 그 회차) 시작의 로컬 날짜.
 * 일정 제목이 비면 `11/18 회의록`. 노트 제목 한도(255자)를 넘으면 일정 제목 쪽을 줄인다 — 날짜·「회의록」은 남긴다.
 */
export function meetingNoteTitle(title: string, start: Date): string {
  const md = `${start.getMonth() + 1}/${start.getDate()}`
  const t = title.trim()
  if (!t) return `${md} 회의록`
  const room = WIKI_TITLE_MAX - `${md}  회의록`.length
  return `${md} ${t.slice(0, room)} 회의록`
}

/**
 * 새 일정에서 정해 둔 회의록의 지금 제목 — 창에서 사람이 제목을 고치지 않았으면 지금 폼의 일정 제목·시작으로 다시 만들어
 * 창을 연 뒤 날짜·제목을 바꿔도 노트 제목이 저장되는 일정과 맞는다. 고쳤으면 사람의 제목을 지킨다.
 * 시작 칸이 비어 날짜가 아니면 정해 둔 제목을 쓴다.
 */
export function draftMeetingNoteTitle(
  draft: { title: string; titleEdited: boolean },
  formTitle: string,
  formStart: string,
): string {
  if (draft.titleEdited) return draft.title
  const start = new Date(formStart)
  return Number.isNaN(start.getTime()) ? draft.title : meetingNoteTitle(formTitle, start)
}

/**
 * 틀의 참석자 이름 — 같은 사람(key: 사용자 id·외부 이메일 등)은 한 번만 넣는다. 이름이 같아도 다른 사람이면 둘 다 남긴다.
 * 빈 이름은 뺀다. 순서는 들어온 그대로.
 */
export function uniqueAttendeeNames(items: { key: string; name: string }[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const { key, name } of items) {
    if (seen.has(key) || !name.trim()) continue
    seen.add(key)
    out.push(name.trim())
  }
  return out
}

/**
 * 「일시」 값 — 같은 날 `11월 18일 (수) 10:00–11:00`, 여러 날 `11월 18일 (수) 10:00 – 11월 19일 (목) 11:00`,
 * 종일 `11월 18일 (수) 종일`(여러 날이면 `… – 11월 19일 (목) 종일`). 종일의 end 는 폼 값처럼 마지막 날 다음 자정(반열림)이다.
 */
function formatWhen(start: Date, end: Date, allDay: boolean, now: Date): string {
  const startDay = formatLocalDateWithWeekday(start, now)
  if (allDay) {
    // 반열림 [start, end) — 마지막 날은 end 하루 전. 길이 0 이하면 시작일 하루로 본다.
    const last = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start
    return isSameDay(start, last) ? `${startDay} 종일` : `${startDay} – ${formatLocalDateWithWeekday(last, now)} 종일`
  }
  if (isSameDay(start, end)) return `${startDay} ${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`
  return `${startDay} ${format(start, 'HH:mm')} – ${formatLocalDateWithWeekday(end, now)} ${format(end, 'HH:mm')}`
}

/**
 * 회의록 틀 — 일시·장소·참석 줄과 안건·결정·할 일 머리말. 장소·참석이 비면 그 줄째 뺀다(빈 「참석 ·」을 남기지 않는다).
 * 참석은 이름을 `, ` 로 잇는다(AI 참석자 포함).
 */
export function meetingNoteTemplate(
  input: { start: Date; end: Date; allDay: boolean; location?: string | null; attendeeNames: string[] },
  now: Date = new Date(),
): MeetingNoteTemplate {
  const facts: { label: string; value: string }[] = [{ label: '일시', value: formatWhen(input.start, input.end, input.allDay, now) }]
  const location = input.location?.trim()
  if (location) facts.push({ label: '장소', value: location })
  const names = input.attendeeNames.map((n) => n.trim()).filter(Boolean)
  if (names.length > 0) facts.push({ label: '참석', value: names.join(', ') })

  const lines: MeetingNoteTemplateLine[] = [...facts, ...SECTIONS.map((label) => ({ label }))]
  const markdown = [
    ...facts.map((f) => `- ${f.label}: ${f.value}`),
    '',
    ...SECTIONS.flatMap((s) => [`## ${s}`, '']),
  ].join('\n')
  return { lines, markdown }
}

/** 위치 기억 키 베이스 — 사람·워크스페이스마다 따로(WP-701, userScopedKey). */
const STORAGE_BASE = 'calendar.meetingNoteLocation'

/** 지난번 회의록 위치 — 없거나 깨졌거나 모양이 틀리면 null(저장소 값은 믿지 않고 검사한다). */
export function loadMeetingNoteLocation(owner: StorageOwner): MeetingNoteLocation | null {
  const raw = readStored(userScopedKey(STORAGE_BASE, owner))
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as Partial<MeetingNoteLocation> | null
    if (typeof v?.spaceId !== 'number') return null
    if (v.parentId !== null && typeof v.parentId !== 'number') return null
    return { spaceId: v.spaceId, parentId: v.parentId }
  } catch {
    return null
  }
}

/** 회의록을 만든 자리를 기억한다 — 저장소가 막혀도 이 탭에서는 기억하고, 만들기는 계속된다(storageWithFallback). */
export function saveMeetingNoteLocation(owner: StorageOwner, loc: MeetingNoteLocation): void {
  writeStored(userScopedKey(STORAGE_BASE, owner), JSON.stringify({ spaceId: loc.spaceId, parentId: loc.parentId }))
}

/** 노트를 만들 수 있는 공간 — 소유자·편집자(VIEWER 는 만들 수 없다). 순서는 그대로. */
export function writableSpaces(spaces: WikiSpace[]): WikiSpace[] {
  return spaces.filter((s) => isEditRole(s.role))
}

/**
 * 창을 열 때 쓸 자리 — 지난번 위치가 살아 있으면 그곳, 아니면 내 공간 최상위.
 * - 저장된 공간이 목록에 없거나(나갔음·지워짐) 쓸 수 없으면(VIEWER) → 내 공간 최상위.
 * - 저장된 상위 노트가 그 공간 트리(savedSpacePages)에 없으면(지워짐·트리 못 읽음) → 그 공간 최상위가 아니라 내 공간 최상위(기획 WP-1694).
 * - 내 공간(PERSONAL, ownerId=나)도 없으면 쓸 수 있는 첫 공간 최상위, 그것도 없으면 null(만들기 잠금).
 */
export function resolveMeetingNoteLocation(
  saved: MeetingNoteLocation | null,
  spaces: WikiSpace[],
  myUserId: number | null | undefined,
  savedSpacePages?: { id: number }[],
): ResolvedMeetingNoteLocation | null {
  const writable = writableSpaces(spaces)
  if (saved && writable.some((s) => s.id === saved.spaceId)) {
    if (saved.parentId == null) return { spaceId: saved.spaceId, parentId: null, source: 'saved' }
    if (savedSpacePages?.some((p) => p.id === saved.parentId)) {
      return { spaceId: saved.spaceId, parentId: saved.parentId, source: 'saved' }
    }
  }
  const mine = writable.find((s) => s.type === 'PERSONAL' && s.ownerId === myUserId)
  if (mine) return { spaceId: mine.id, parentId: null, source: 'mine' }
  const first = writable[0]
  return first ? { spaceId: first.id, parentId: null, source: 'fallback' } : null
}
