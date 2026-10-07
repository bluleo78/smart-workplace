// 포커스 가능한 스크롤 영역 공용 속성(WP-277) — 드라이브 미리보기 표(CSV·XLSX)와 통합 뷰어(이미지·PDF)가 같이 쓴다.
// 왜: 통합 뷰어는 ←/→ 를 파일 넘김에 쓰는데, 포커스가 실제로 가로로 넘치는 data-hscroll 영역 안에 있으면
// 그 키를 영역 스크롤에 양보한다. 그 판정 표식(data-hscroll)·포커스 가능(tabIndex)·접근 이름을 한 곳에서 같은 모양으로 단다.
// 드라이브 미리보기가 뷰어 내부 모듈에 기대지 않도록 중립 위치(lib)에 둔다.

/** 스크롤 영역 속성 — 뷰어 키 판정(data-hscroll)·포커스 가능(tabIndex)·region 역할과 접근 이름(label). */
export function scrollRegionProps(label: string) {
  return { 'data-hscroll': '', tabIndex: 0, role: 'region', 'aria-label': label } as const
}

/** 스크롤 영역의 포커스 표시(토큰 색 링). */
export const SCROLL_REGION_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** 화면을 꽉 채우는 스크롤 영역용 — 바깥 링이 잘리지 않게 안쪽(inset) 링으로 그린다. */
export const SCROLL_REGION_RING_INSET =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
