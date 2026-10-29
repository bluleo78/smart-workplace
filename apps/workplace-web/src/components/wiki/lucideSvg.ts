import type { LucideIcon } from 'lucide-react'

/** lucide 아이콘 모양 — lucide-react 의 iconNode 와 같은 [태그, 속성] 목록. */
type IconNode = Array<[string, Record<string, string>]>

const SVG_NS = 'http://www.w3.org/2000/svg'

const iconNodes = new WeakMap<LucideIcon, IconNode>()

/**
 * lucide-react 아이콘 컴포넌트의 모양(iconNode)을 읽는다 — 모양을 문자열로 복사해 두면 lucide 를 올릴 때 컴포넌트로 그린 아이콘과
 * 어긋난다(WP-1185). lucide-react 아이콘은 createLucideIcon 이 만든 forwardRef 로, 렌더 함수가 <Icon iconNode=…> 를 돌려준다.
 * 이 구조가 바뀌면 lucideSvg 테스트(React 로 그린 아이콘과 같은 모양인지)가 잡는다.
 */
function iconNodeOf(icon: LucideIcon): IconNode {
  let node = iconNodes.get(icon)
  if (!node) {
    const { render } = icon as unknown as { render: (props: object, ref: null) => { props: { iconNode: IconNode } } }
    node = render({}, null).props.iconNode
    iconNodes.set(icon, node)
  }
  return node
}

/**
 * lucide 아이콘을 React 밖 DOM 으로 만든다 — 편집기 데코레이션 위젯(✦ 표식·앱 링크 칩)은 컴포넌트를 쓸 수 없다.
 * 모양은 그 아이콘 컴포넌트에서 읽고, 바깥 속성(선 굵기·둥근 끝)은 lucide-react 기본값과 같으며, 화면 읽기에서는 숨긴다.
 */
export function lucideSvg(icon: LucideIcon, className: string): SVGElement {
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
  for (const [tag, a] of iconNodeOf(icon)) {
    const el = document.createElementNS(SVG_NS, tag)
    // key 는 React 목록용 속성이라 DOM 에 옮기지 않는다.
    for (const [k, v] of Object.entries(a)) if (k !== 'key') el.setAttribute(k, v)
    svg.append(el)
  }
  return svg
}
