// 모바일 셸 전환 기준 — Tailwind lg 미만. AppRail 드로어 전환(lg:/max-lg:) 기준과 반드시 같아야 한다.
// Tailwind v4 의 lg 는 `(width >= 64rem)` 이므로 정확한 여집합 `(width < 64rem)` 을 쓴다.
// 예전 '(max-width: 1023px)' 는 1023px 초과 1024px 미만(소수 폭 — 브라우저 줌·DPR 에 따라 생김)에서
// 모바일도 데스크톱도 아닌 틈이 생겨, JS(모바일 셸)와 CSS(max-lg:/lg:)가 서로 다른 레이아웃을 가리킬 수 있었다.
export const MOBILE_MEDIA_QUERY = '(width < 64rem)'
