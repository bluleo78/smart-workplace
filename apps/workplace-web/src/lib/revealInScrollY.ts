// 세로 스크롤 영역 안의 항목을 보이게 맞추는 도우미(WP-1462) — revealInScrollX 의 세로판. 노트 트리에서 새로 연 페이지 행이 목록 밖에 남았다.
// scrollIntoView 는 바깥 overflow 조상(사이드바 헤더를 품은 영역 등)까지 굴릴 수 있어, 영역(container)의 scrollTop 만 바꾼다.

/** 위치를 재는 데 필요한 것만 — 단위 테스트에서 가짜 객체로 대신한다. */
type Box = { getBoundingClientRect(): { top: number; bottom: number } }

/** child 가 container 의 보이는 높이 밖에 걸쳐 있으면 container 를 세로로 굴려 다 보이게 한다. 이미 다 보이면 그대로 둔다. */
export function revealInScrollY(container: Box & { scrollTop: number }, child: Box): void {
  const c = container.getBoundingClientRect()
  const r = child.getBoundingClientRect()
  if (r.top < c.top) container.scrollTop -= c.top - r.top
  else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom
}
