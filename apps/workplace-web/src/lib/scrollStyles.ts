// 가로 스크롤 영역의 스크롤바 숨김 — 칩 줄(툴바·타임라인 아젠다·필터 줄·메일 첨부 등)이 같은 규칙을 쓴다.
// shadcn 의 no-scrollbar 유틸리티(shadcn/tailwind.css)를 쓰는 이유: 표준(scrollbar-width)·webkit(::-webkit-scrollbar)·
// ms(-ms-overflow-style) 세 가지를 한 번에 숨기고, 모든 숨김 지점이 한 규칙을 공유해 일부만 빠지는 일을 막는다.
// 전역 스크롤바 규칙이 @layer base 안에 있어 이 유틸리티가 cascade 에서 이긴다(WP-1502).
export const HIDE_SCROLLBAR = 'no-scrollbar';
