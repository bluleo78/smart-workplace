/**
 * 빈 상태 규격 클래스 — 디자인 시스템 06 §B 규격의 단일 원본(WP-1924).
 * 아이콘 40px muted · 제목 14px/500 · 본문 12px muted. 대화 빈 상태·드라이브·노트도 이것을 가져다 써 모양이 갈라지지 않게 한다.
 */
/** 빈 상태 아이콘 크기(40px) — 일반·긍정 아이콘이 같은 크기를 쓰도록 한 곳에 둔다. */
const emptyStateIconSize = 'h-10 w-10'
export const emptyStateIconClass = `${emptyStateIconSize} text-muted-foreground`
export const emptyStateTitleClass = 'text-sm font-medium'
export const emptyStateDescriptionClass = 'text-xs text-muted-foreground'

/**
 * 긍정 빈 상태(할 일을 다 끝냄) 체크 아이콘 — 06 §B 의 유일한 색 예외(WP-1939).
 * '비었다'가 아니라 '다 끝냈다'를 뜻하므로 muted 대신 primary. 크기는 일반 규격과 같다.
 */
export const emptyStatePositiveIconClass = `${emptyStateIconSize} text-primary`

/**
 * 모바일 전체 화면 변형(WP-1939, U3-R11) — 하단 탭바 화면이라 데스크톱보다 크게 쓴다.
 * 아이콘 48px · 제목 17px semibold · 본문 14px. 색은 데스크톱 규격과 같은 muted(흐린 /40 색 금지).
 */
export const mobileEmptyStateIconClass = 'h-12 w-12 text-muted-foreground'
export const mobileEmptyStateTitleClass = 'text-[17px] font-semibold'
export const mobileEmptyStateDescriptionClass = 'text-sm text-muted-foreground'
