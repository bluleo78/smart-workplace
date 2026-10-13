// 선택 상태 표시 공용 클래스(WP-368) — 디자인 시스템 01 「선택 상태 표시 규칙」의 단일 원본.
// 예전엔 선택을 bg-accent(hover 와 같은 토큰) + font-medium 만으로 표시해 다크·라이트 모두 거의 구분되지 않았다.
// cn() 의 tailwind-merge 가 bg-·font-·text- 충돌을 뒤쪽 값으로 정리하므로, 기본 클래스 뒤에 붙여 쓴다.

/**
 * 선택 표시의 바탕만 — 왼쪽 primary 막대 + 선택 전용 배경. 글자 굵기·색은 건드리지 않는다.
 * 행 안에서 굵기 자체가 의미를 갖는 목록(메일 목록: 굵게 = 안 읽음)에 쓴다. 그 외에는 SELECTED_ROW_CLASS.
 */
export const SELECTED_SURFACE_CLASS = 'selection-bar bg-selected'

/**
 * 목록에서 현재 고른 항목(사이드바 메뉴·에픽·트리 노드·시트 행 등).
 * 왼쪽 primary 막대(selection-bar) + 선택 전용 배경(--selected) + 굵게. 글자는 전경색 그대로 둔다
 * — 에픽 색 점처럼 항목 고유 색과 섞이지 않고, 파란 글자(링크·켜진 토글)와 의미가 겹치지 않게.
 */
export const SELECTED_ROW_CLASS = `${SELECTED_SURFACE_CLASS} font-semibold text-foreground`

/**
 * 막대 없는 선택 — 배경(--selected)만 쓴다. 행 왼쪽 막대가 이미 다른 의미로 쓰이는 목록용(메일 목록: 안 읽음 막대가 같은 자리·같은 색).
 * 굵기도 건드리지 않는다(메일은 굵게 = 안 읽음). 막대가 겹쳐 선택이 안 읽음 막대에 묻히거나 읽은 메일이 안 읽음처럼 보이는 것을 막는다.
 */
export const SELECTED_BG_CLASS = 'bg-selected'

/**
 * 다중 선택 모드(체크로 여러 개를 고른 행) — "현재 고른 하나"가 아니므로 막대 없이 옅은 primary 배경만 쓴다.
 * 모바일 이슈 목록·드라이브 목록의 선택 모드 행이 같은 표시를 공유한다.
 */
export const MULTI_SELECTED_ROW_CLASS = 'bg-primary/10'

/**
 * 앞에 아이콘이 있는 사이드바 메뉴의 선택 행 — 앞 아이콘(행의 직계 첫 svg)만 primary 로 한 번 더 강조한다.
 * 행 안의 다른 svg(뒤쪽 보조 아이콘 등)까지 칠하지 않도록 첫 자식 svg 로 좁혔다. 아이콘이 span 으로 감싸인 행엔 적용되지 않는다.
 */
export const SELECTED_NAV_CLASS = `${SELECTED_ROW_CLASS} [&>svg:first-child]:text-primary`

/**
 * 켜고 끄는 버튼(aria-pressed)의 켜짐 상태 — 메일 「안 읽음만」과 같은 primary 테두리·연한 primary 배경·primary 글자.
 * ghost 버튼에 쓸 때는 꺼짐 상태에도 border border-transparent 를 줘서 켜질 때 폭이 2px 밀리지 않게 한다.
 * hover 도 켜짐 색을 유지한다(버튼 기본 hover:bg-accent·hover:text-accent-foreground 를 덮는다).
 */
export const TOGGLE_ON_CLASS =
  'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:border-primary/50 dark:bg-primary/15 dark:hover:bg-primary/20'

/**
 * 테두리 상자를 못 쓰는 바 버튼(하단 액션 바의 아이콘+라벨 칸 등)의 켜짐 상태 — 아이콘·글자만 primary 로, 굵게.
 * 켜짐이 색 하나에만 의존하지 않도록 굵기를 함께 바꾼다. aria-pressed 와 같이 쓴다.
 */
export const TOGGLE_ON_TEXT_CLASS = 'font-semibold text-primary'
