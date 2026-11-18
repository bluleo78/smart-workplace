// 링크로 도착한 행을 화면 가운데로 보여 주는 공용 스크롤(WP-1732) — 이슈 코멘트 링크·메시지 링크·드라이브 「드라이브에서 열기」 강조가 함께 쓴다.
// 왜: 가운데로 맞춰야 상단 고정 헤더·하단 작성창에 가리지 않고, 움직임 줄이기 설정(prefers-reduced-motion)이면 부드러운 스크롤 대신 바로 옮겨야 한다.
// 같은 판정을 화면마다 따로 쓰면 한쪽만 설정을 놓치기 쉬워 한 곳에 둔다.

/** el 을 스크롤 영역 가운데로 옮긴다 — 움직임 줄이기 설정이면 애니메이션 없이 바로. */
export function scrollIntoViewCentered(el: Element): void {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
}
