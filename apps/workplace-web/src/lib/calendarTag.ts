// 캘린더 태그 순수 함수(WP-714) — 태그 피커·사이드바가 공유한다. 화면 없이 단위 테스트로 고정한다(calendarTag.test.ts).
import { PALETTE_KEYS } from '@/lib/calendarPalette'
import { hashString } from '@/lib/project-color'

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
