// WP-1943: 연락처 검색·필터 결과를 스크린리더에 알릴 한국어 문구를 만드는 순수 함수.

import type { ContactTypeFilter } from '@/types/contact'

/** 결과 안내 조건 — 목록(검색어·보기·조직·직책)과 그룹(그룹·검색어). */
export type ContactResultCondition =
  | { mode: 'list'; query: string; type: ContactTypeFilter; organization: string; title: string }
  | { mode: 'group'; groupId: number; query: string }

/**
 * 결과 안내 조건 키(WP-1943 리뷰 후속). 조건에 자유 입력(검색어·조직·직책)이 들어가므로
 * 구분자로 이어 붙이지 않고 `JSON.stringify` 로 만든다 — `a|b`+`c` 와 `a`+`b|c` 가 같은 키가 되어
 * 안내가 누락되는 것을 막는다(IssueResultStatus 와 같은 방식).
 */
export function contactResultKey(condition: ContactResultCondition): string {
  return condition.mode === 'list'
    ? JSON.stringify(['list', condition.query, condition.type, condition.organization, condition.title])
    : JSON.stringify(['group', condition.groupId, condition.query])
}

/**
 * 안내 문구 입력 — 목록 모드(건수·더 있음·검색 중·즐겨찾기)와 그룹(하위 조직 포함) 모드.
 * searching 은 검색어·조직·직책 중 어느 조건이든 걸려 있다는 뜻이다.
 */
export type ContactResultInput =
  | { mode: 'list'; count: number; more: boolean; searching: boolean; favorite: boolean }
  | { mode: 'group'; count: number }

/**
 * 결과 상태를 한 문장으로 만든다.
 * - 0건이면 맥락(검색·즐겨찾기)에 맞는 빈 결과 문구, 아니면 건수를 알린다.
 * - 더 불러올 수 있으면(more) 정확한 총계를 모르므로 「이상」을 붙인다.
 */
export function contactResultAnnouncement(input: ContactResultInput): string {
  if (input.mode === 'group') {
    return input.count > 0 ? `하위 조직 포함 검색 결과 ${input.count}명` : '검색 결과가 없습니다'
  }
  if (input.count === 0) {
    if (input.searching) return '검색 결과가 없습니다'
    return input.favorite ? '즐겨찾기한 연락처가 없습니다' : '연락처가 없습니다'
  }
  return input.more ? `연락처 ${input.count}명 이상` : `연락처 ${input.count}명`
}
