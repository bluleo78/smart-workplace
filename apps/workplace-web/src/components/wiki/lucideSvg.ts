/** lucide 아이콘 모양 — lucide-react 의 iconNode 와 같은 [태그, 속성] 목록. */
export type LucideShapes = Array<[string, Record<string, string>]>

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * lucide 아이콘을 React 밖 DOM 으로 만든다 — 편집기 데코레이션 위젯(✦ 표식·앱 링크 칩)은 컴포넌트를 쓸 수 없다.
 * 바깥 속성(선 굵기·둥근 끝)은 lucide-react 기본값과 같고, 화면 읽기에서는 숨긴다.
 */
export function lucideSvg(shapes: LucideShapes, className: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const attrs: Record<string, string> = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: className,
  }
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
  for (const [tag, a] of shapes) {
    const el = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(a)) el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}
