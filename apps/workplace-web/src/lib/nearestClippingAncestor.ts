/**
 * el 의 가장 가까운 "잘라 내는" 조상(overflow 가 visible 이 아닌 요소 — 스크롤 영역·표 감싸개·코드 블록 등). 없으면 null.
 * 떠 있는 UI(툴바·태그)가 잘리는지 재는 곳(메시지 툴바 뒤집기·노트 ✦ 태그 배치)이 같은 규칙으로 찾도록 한곳에 둔다.
 *
 * @param stopAt 이 요소에 닿으면 멈춘다(그 요소와 그 위는 보지 않는다). 없으면 문서 끝까지.
 * @param axis 'y' 면 세로 overflow 만 본다(위·아래로 잘리는지만 따지는 곳), 'both' 면 가로·세로 중 하나라도.
 * @param cache 여러 요소를 연달아 잴 때 조상별 판정을 재사용한다(getComputedStyle 반복 방지).
 */
export function nearestClippingAncestor(
  el: HTMLElement,
  stopAt: HTMLElement | null = null,
  axis: 'both' | 'y' = 'both',
  cache?: Map<HTMLElement, boolean>,
): HTMLElement | null {
  for (let node = el.parentElement; node && node !== stopAt; node = node.parentElement) {
    let clips = cache?.get(node)
    if (clips === undefined) {
      const style = getComputedStyle(node)
      clips = style.overflowY !== 'visible' || (axis === 'both' && style.overflowX !== 'visible')
      cache?.set(node, clips)
    }
    if (clips) return node
  }
  return null
}
