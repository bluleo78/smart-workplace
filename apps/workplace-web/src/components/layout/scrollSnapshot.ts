// src/components/layout/scrollSnapshot.ts
// WP-1488: 셸 전환(PageHost 를 appendChild 로 옮김) 때 브라우저가 잃어버리는 하위 스크롤 오프셋을 저장·복원하는 도우미.
// DOM 노드를 떼었다 붙이면 브라우저는 하위 요소의 scrollTop/scrollLeft 를 0 으로 되돌린다.

/** 스크롤된 요소와 그 오프셋 목록. */
export type ScrollSnapshot = Array<{ el: Element; top: number; left: number }>

/**
 * root 자신과 하위 요소 중 스크롤 오프셋이 0 이 아닌 것만 기록한다.
 * 0 인 요소는 복원할 필요가 없어 제외한다(전체 요소를 담으면 불필요하게 크다).
 */
export function captureScroll(root: Element): ScrollSnapshot {
  const snapshot: ScrollSnapshot = []
  const visit = (el: Element) => {
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
      snapshot.push({ el, top: el.scrollTop, left: el.scrollLeft })
    }
  }
  visit(root)
  root.querySelectorAll('*').forEach(visit)
  return snapshot
}

/**
 * 저장해 둔 오프셋을 되돌린다. 복원 시점에 문서에서 빠진(지워진) 요소는 건드리지 않는다.
 * root 포함 여부가 아니라 isConnected 로 거른다 — 중첩 셸에서는 안쪽 호스트가 바깥 호스트의 하위로 다시 붙은 뒤에 복원하므로
 * 요소가 어느 root 아래인지보다 문서에 붙어 있는지가 기준이다.
 * 복원 시점에 이미 0 이 아닌 오프셋을 가진 요소는 페이지 코드가 스스로 위치를 정한 것으로 보고 건드리지 않는다.
 * 한계: 같은 커밋에서 페이지가 일부러 0(맨 위)으로 옮긴 경우는 이동으로 잃은 것과 가릴 수 없어 저장한 값으로 되돌린다.
 */
export function restoreScroll(snapshot: ScrollSnapshot): void {
  for (const { el, top, left } of snapshot) {
    if (!el.isConnected) continue
    // 이동으로 잃은(0 으로 돌아간) 요소만 되돌린다 — 같은 커밋에서 페이지가 일부러 옮긴 위치(맨 아래 붙이기 등)는 덮지 않는다.
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) continue
    el.scrollTop = top
    el.scrollLeft = left
  }
}
