// 선택 상태 표시 공용 클래스(WP-368) — 디자인 시스템 01 「선택 상태 표시 규칙」의 단일 원본.
// 예전엔 선택을 bg-accent(hover 와 같은 토큰) + font-medium 만으로 표시해 다크·라이트 모두 거의 구분되지 않았다.
// cn() 의 tailwind-merge 가 bg-·font-·text- 충돌을 뒤쪽 값으로 정리하므로, 기본 클래스 뒤에 붙여 쓴다.

/**
 * 목록에서 현재 고른 항목(사이드바 메뉴·에픽·트리 노드·시트 행 등).
 * 왼쪽 primary 막대(selection-bar) + 선택 전용 배경(--selected) + 굵게. 글자는 전경색 그대로 둔다
 * — 에픽 색 점처럼 항목 고유 색과 섞이지 않고, 파란 글자(링크·켜진 토글)와 의미가 겹치지 않게.
 */
export const SELECTED_ROW_CLASS = 'selection-bar bg-selected font-semibold text-foreground'

/** 앞에 아이콘이 있는 사이드바 메뉴의 선택 행 — 아이콘만 primary 로 한 번 더 강조한다. */
export const SELECTED_NAV_CLASS = `${SELECTED_ROW_CLASS} [&_svg]:text-primary`

/**
 * 켜고 끄는 버튼(aria-pressed)의 켜짐 상태 — 메일 「안 읽음만」과 같은 primary 테두리·연한 primary 배경·primary 글자.
 * ghost 버튼에 쓸 때는 꺼짐 상태에도 border border-transparent 를 줘서 켜질 때 폭이 2px 밀리지 않게 한다.
 * hover 도 켜짐 색을 유지한다(버튼 기본 hover:bg-accent·hover:text-accent-foreground 를 덮는다).
 */
export const TOGGLE_ON_CLASS =
  'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:border-primary/50 dark:bg-primary/15 dark:hover:bg-primary/20'
