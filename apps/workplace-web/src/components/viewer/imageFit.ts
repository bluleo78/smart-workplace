/**
 * 맞춤(확대 1) 상태의 이미지 CSS 폭 — 상자(본문 내용 영역) 안에 이미지 전체가 보이도록 폭·높이 중 빡빡한 쪽에 맞춘다(WP-277).
 * 원본보다 키우지는 않는다(작은 아이콘이 흐릿하게 커지지 않게). 확대는 이 폭 × 배율로 명시해 레이아웃 크기 자체를 키운다 —
 * transform 확대는 레이아웃이 그대로라 스크롤 영역이 늘지 않아 위·왼쪽을 볼 수 없었다.
 * 정수 픽셀로 내린다 — 소수 폭이면 비율로 정해지는 높이가 반올림으로 상자를 미세하게 넘쳐 스크롤바가 생기고,
 * 그 스크롤바가 상자를 줄여 다시 계산되는 ResizeObserver 되먹임(깜빡임)이 날 수 있다.
 * 크기를 아직 모르면(로드 전·숨김 상자) null.
 */
export function fitImageWidth(naturalW: number, naturalH: number, boxW: number, boxH: number): number | null {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) return null
  return Math.floor(Math.min(naturalW, boxW, (boxH * naturalW) / naturalH))
}
