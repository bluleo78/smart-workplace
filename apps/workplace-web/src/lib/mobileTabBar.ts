// 모바일 하단 탭바 높이 — MobileTabBar 가 렌더된 높이(안전영역 포함)를 :root 의 --mobile-tabbar-h 로 공개한다(탭바가 없으면 지워져 0).
// 팝오버의 충돌 여백(collisionPadding)처럼 CSS 변수를 쓸 수 없는 숫자 자리에서 읽는다 — 탭바 뒤로 팝오버가 숨지 않고 위로 뒤집히게.

/**
 * 지금 보이는 모바일 하단 탭바 높이(px). 탭바가 없거나(데스크톱·상세 화면) 변수가 없으면 0.
 * MobileTabBar 가 :root 인라인 스타일로 넣으므로 인라인 값을 읽는다 — getComputedStyle 과 달리 스타일 재계산을 일으키지 않아
 * 렌더(입력 한 글자마다 다시 그리는 폼 안)에서 불러도 싸다.
 */
export function mobileTabBarHeight(): number {
  if (typeof document === 'undefined') return 0
  return parseFloat(document.documentElement.style.getPropertyValue('--mobile-tabbar-h')) || 0
}

/**
 * 하단 탭바 위 영역 가운데에 두는 다이얼로그 배치(WP-801) — 위치를 탭바 위 영역의 가운데로, 높이를 그 영역 안으로 줄인다.
 * 화면 전체 기준이면 다이얼로그 아래끝이 탭바에 붙어 탭바 밑으로 이어지는 것처럼 보였다(탭바가 없으면 변수가 지워져 화면 전체 기준).
 */
export const DIALOG_ABOVE_TAB_BAR_CLASS =
  'top-[calc((100dvh-var(--mobile-tabbar-h,0px))/2)] max-h-[min(85vh,calc(100dvh-var(--mobile-tabbar-h,0px)-2rem))]'

/** 팝오버 충돌 여백 — 화면 가장자리에서 edge(px) 띄우고, 아래쪽은 하단 탭바 높이만큼 더 띄운다. */
export function popoverCollisionPadding(edge = 16): { top: number; right: number; bottom: number; left: number } {
  return { top: edge, right: edge, bottom: edge + mobileTabBarHeight(), left: edge }
}
