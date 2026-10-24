// 이슈 목록 공용 스타일(WP-919) — 프로젝트 목록·내 작업·지켜보는 이슈·개인 목록의 헤더 모양을 한곳에서 맞춘다.

/** 목록 열 머리 셀 — 프로젝트 목록 CycleSectionColumnHead 의 visible 셀과 같은 값(작은 회색 글자, 왼쪽 정렬). */
export const LIST_HEAD_CELL_CLASS = 'py-1.5 text-left text-xs font-normal text-muted-foreground'

/**
 * ID 열 머리 들여쓰기 — ID 칸 내용은 유형 아이콘(1rem) + gap(0.375rem) 뒤에 키 글자가 오므로,
 * 헤더 「ID」 글자를 키 글자 시작에 맞추려고 같은 폭만큼 민다. 내 작업과 프로젝트 목록이 함께 쓴다.
 */
export const LIST_ID_HEAD_INDENT_CLASS = 'pl-[1.375rem]'
