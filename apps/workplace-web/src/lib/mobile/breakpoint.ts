// 모바일 셸 전환 기준 — Tailwind lg 미만. AppRail 드로어 전환(lg:/max-lg:) 기준과 반드시 같아야 한다.
// Tailwind v4 의 lg 는 `(width >= 64rem)` 이므로 정확한 여집합 `(width < 64rem)` 을 쓴다.
// 예전 '(max-width: 1023px)' 는 1023px 초과 1024px 미만(소수 폭 — 브라우저 줌·DPR 에 따라 생김)에서
// 모바일도 데스크톱도 아닌 틈이 생겨, JS(모바일 셸)와 CSS(max-lg:/lg:)가 서로 다른 레이아웃을 가리킬 수 있었다.
export const MOBILE_MEDIA_QUERY = '(width < 64rem)'

// 하단 탭바를 7칸(사용자 5칸)으로 넓히는 기준 — 390pt 이상(iPhone 12 이후 일반·Pro·Pro Max, Pixel 등 412dp 안드로이드)이면
// 칸당 54pt 이상으로 누르기 최소 크기(44pt)를 넉넉히 넘는다. 그보다 좁은 폰(SE 등)은 5칸(사용자 3칸)을 유지한다(WP-877).
export const TAB_BAR_WIDE_MEDIA_QUERY = '(width >= 390px)'

// 데스크톱이지만 좁은 창(노트북 1366·「텍스트 크게」 배율 등) — 1280px 미만. 작업 관리 사이드바를 아이콘 줄로 접어
// 이슈 목록 제목 칸을 넓힌다(WP-506 B안). 에픽 패널을 늘 켜 두고 일하는 사용 방식을 그대로 두려고 사이드바 쪽을 줄인다.
// 모바일(64rem 미만)과 겹치는 구간은 모바일 셸이 먼저라 실제로는 1024~1279px 데스크톱에서만 쓰인다.
export const SIDEBAR_COMPACT_MEDIA_QUERY = '(width < 80rem)'
