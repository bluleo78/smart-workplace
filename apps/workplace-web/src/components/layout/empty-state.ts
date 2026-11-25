/**
 * 빈 상태 규격 클래스 — 디자인 시스템 06 §B 규격의 단일 원본(WP-1924).
 * 아이콘 40px muted · 제목 14px/500 · 본문 12px muted. 대화 빈 상태·드라이브·노트도 이것을 가져다 써 모양이 갈라지지 않게 한다.
 */
/** 빈 상태 아이콘 크기(40px) — 일반·긍정 아이콘이 같은 크기를 쓰도록 한 곳에 둔다. */
const emptyStateIconSize = 'h-10 w-10'
export const emptyStateIconClass = `${emptyStateIconSize} text-muted-foreground`
export const emptyStateTitleClass = 'text-sm font-medium'
/**
 * 빈 상태 설명 — break-keep 으로 한국어를 단어 단위로 줄바꿈한다(WP-2051).
 * 기본 word-break 는 한국어를 글자마다 끊어 「있 / 어요.」처럼 단어 중간에서 꺾고 마지막 줄에 한 글자만 남길 수 있다.
 * break-words — keep-all 은 띄어쓰기 없는 긴 낱말(사용자가 지은 이름 등)을 끊지 못하므로 칸을 넘칠 때만 끊는 대비책.
 */
const emptyStateDescriptionWrap = 'break-keep break-words'
export const emptyStateDescriptionClass = `text-xs text-muted-foreground ${emptyStateDescriptionWrap}`

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
/** 모바일 긍정 빈 상태 아이콘 — 크기는 모바일 규격(48px), 색만 primary(WP-1947). */
export const mobileEmptyStatePositiveIconClass = 'h-12 w-12 text-primary'
export const mobileEmptyStateTitleClass = 'text-[17px] font-semibold'
/** 모바일 설명도 데스크톱과 같은 이유로 단어 단위 줄바꿈(WP-2051). */
export const mobileEmptyStateDescriptionClass = `text-sm text-muted-foreground ${emptyStateDescriptionWrap}`
