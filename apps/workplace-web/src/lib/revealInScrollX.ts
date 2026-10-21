// 가로 스크롤 줄 안의 항목을 보이게 맞추는 도우미(WP-676) — 모바일 칩 줄에서 켜진 칩이 화면 밖에 있으면 어떤 보기인지 알 수 없었다.
// scrollIntoView 는 세로로 페이지까지 굴릴 수 있어, 줄(container)의 scrollLeft 만 바꾼다.

/** 위치를 재는 데 필요한 것만 — 단위 테스트에서 가짜 객체로 대신한다. */
type Box = { getBoundingClientRect(): { left: number; right: number } }

/**
 * child 가 container 의 보이는 폭 밖에 걸쳐 있으면 container 를 가로로 굴려 다 보이게 한다. 이미 다 보이면 그대로 둔다.
 * pad 만큼 여유를 두어 칩이 줄 끝에 딱 붙지 않게 한다.
 */
export function revealInScrollX(container: Box & { scrollLeft: number }, child: Box, pad = 16): void {
  const c = container.getBoundingClientRect()
  const r = child.getBoundingClientRect()
  if (r.left < c.left) container.scrollLeft -= c.left - r.left + pad
  else if (r.right > c.right) container.scrollLeft += r.right - c.right + pad
}
