// 확대 대상(이미지·PDF) 스크롤 영역 공용 속성(WP-277) — 이미지 본문(ViewerBody)과 PDF(PdfPages)가 같이 쓴다.
// 확대 배율과 무관하게 항상 단다: 확대 중에만 tabIndex 를 달면, 그 안에 포커스가 있는 채로 맞춤(0·−)으로 돌아갈 때
// 포커스가 body 로 빠져 뷰어 키(←/→·+/−)가 먹히지 않는다. 넘김 양보는 뷰어가 "실제로 가로로 넘칠 때만" 하므로
// 맞춤 상태에서는 그 안에서도 ←/→ 가 그대로 파일을 넘긴다.

/** 스크롤 영역 속성 — 뷰어 키 판정(data-hscroll)·포커스 가능(tabIndex)·접근 이름. */
export const ZOOM_SCROLL_PROPS = { 'data-hscroll': '', tabIndex: 0, role: 'region', 'aria-label': '미리보기 스크롤 영역' } as const
/** 스크롤 영역의 포커스 표시 — 본문을 꽉 채우므로 안쪽 링(토큰 색). */
export const ZOOM_SCROLL_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
