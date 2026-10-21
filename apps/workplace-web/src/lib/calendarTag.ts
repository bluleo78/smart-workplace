// 캘린더 태그 순수 함수(WP-714) — 태그 피커·사이드바가 공유한다. 화면 없이 단위 테스트로 고정한다(calendarTag.test.ts).
import { PALETTE_KEYS } from '@/lib/calendarPalette'
import { hashString } from '@/lib/project-color'
import type { CalendarEvent } from '@/types/calendar'

/**
 * 새 태그의 색을 이름에서 정한다 — 같은 이름은 항상 같은 팔레트 키.
 * 대소문자를 합쳐 해시한다(서버가 이름을 대소문자 무시로 유일 취급하므로 「Ops」「ops」가 다른 색이 되지 않게).
 * 사용자가 따로 고르지 않은 새 태그의 기본 색이고, 나중에 사이드바에서 바꾼다.
 */
export function pickTagColor(name: string): string {
  return PALETTE_KEYS[hashString(name.trim().toLowerCase()) % PALETTE_KEYS.length]
}

/** 검색어로 태그를 거른다 — 부분 일치, 대소문자 무시(찾기는 관대하게). 빈 검색어는 전부. */
export function filterTagsByName<T extends { name: string }>(tags: T[], search: string): T[] {
  const q = search.trim().toLowerCase()
  return q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags
}

/**
 * 「태그 만들기」로 만들 이름 — 만들 수 없으면 null.
 * 서버 유일 제약이 사용자 안에서 이름 대소문자 무시(lower(name))라, 대소문자만 다른 이름도 「이미 있음」이다
 * (라벨 피커의 labelNameToCreate 는 대소문자를 구분하므로 그대로 쓰지 않는다). 앞뒤 공백은 지운다.
 */
export function tagNameToCreate(search: string, existing: { name: string }[]): string | null {
  const name = search.trim()
  if (name.length === 0) return null
  const lower = name.toLowerCase()
  return existing.some((t) => t.name.toLowerCase() === lower) ? null : name
}

/**
 * 일정에 붙일 태그 id 집합을 토글한 새 배열 — 이미 있으면 빼고 없으면 끝에 더한다.
 * 피커는 이 배열 전체를 PUT 으로 보낸다(부분 갱신이 아니라 교체). 교체라서 요청이 겹치면 늦게 끝난 옛 요청이 이기므로,
 * 피커가 한 번에 하나씩만 보낸다(CalendarTagPicker 의 drain).
 */
export function toggleTagId(selected: number[], id: number): number[] {
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
}

/** 두 태그 id 목록이 같은 집합인지 — 순서는 따지지 않는다. 피커가 이미 서버에 있는 집합을 다시 보내지 않으려고 쓴다. */
export function sameTagIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/** 태그 줄 아래 안내 문구 (WP-716) — 상세 보기 머리·편집 폼 태그 줄이 같은 문구를 쓴다 */
export const TAG_HINT_OUTLOOK_READ_ONLY = 'Outlook 범주에서 가져온 태그예요 · Outlook에서 바꿀 수 있어요'
export const TAG_HINT_OUTLOOK_EVENT = 'Outlook 범주에도 함께 반영돼요 (없던 범주는 색 없이)'
export const TAG_HINT_OUTLOOK_SERIES = '반복 일정 전체의 Outlook 범주에 함께 반영돼요 (없던 범주는 색 없이)'

/**
 * 일정 태그 줄 아래에 둘 안내 — 없으면 null.
 * - 붙일 수 있는 M365 일정: 앱에서 바꾼 태그가 Outlook 범주에도 써 넣어진다는 것(반복 회의면 시리즈 전체). Outlook 범주 목록(masterCategories)에
 *   새로 만들지는 않아 처음 쓰는 이름은 Outlook 에서 색 없이 보인다는 것도 짧게 단다.
 * - 붙일 수 없는 일정(공유받은 읽기 전용 달력의 M365 일정 등): 태그가 있을 때만 Outlook 에서 바꾸라는 안내.
 * - 앱 일정: 안내 없음.
 * 붙일 수 없는 일정은 outlookTagScope 를 보지 않는다 — 앱 일정은 늘 붙일 수 있어, 붙일 수 없으면 Outlook 일정이다(필드가 없는 응답·모킹 호환).
 */
export function eventTagHint(event: Pick<CalendarEvent, 'tags' | 'tagsEditable' | 'outlookTagScope'>): string | null {
  if (event.tagsEditable ?? false) {
    if (event.outlookTagScope === 'SERIES') return TAG_HINT_OUTLOOK_SERIES
    if (event.outlookTagScope === 'EVENT') return TAG_HINT_OUTLOOK_EVENT
    return null
  }
  return (event.tags ?? []).length > 0 ? TAG_HINT_OUTLOOK_READ_ONLY : null
}
