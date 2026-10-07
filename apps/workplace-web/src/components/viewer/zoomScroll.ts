// 확대 시 가로 스크롤 영역 공용 속성(WP-277) — 이미지 본문(ViewerBody)과 PDF(PdfPages)가 같이 쓴다.

/** 확대 시 가로 스크롤 영역 속성 — 뷰어 키 판정(data-hscroll)과 접근 이름. PdfPages 도 같은 값을 쓴다. */
export const ZOOM_SCROLL_PROPS = { 'data-hscroll': '', tabIndex: 0, role: 'region', 'aria-label': '확대 영역 스크롤' } as const
/** 확대 스크롤 영역의 포커스 표시 — 본문을 꽉 채우므로 안쪽 링(토큰 색). */
export const ZOOM_SCROLL_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
