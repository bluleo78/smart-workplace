import { type ReactNode, type ReactPortal, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * 자리를 옮겨 다닐 DOM 노드 손잡이.
 * React 는 부모 요소 타입이 바뀌면 자식을 통째로 다시 만든다(상태·fetch 손실).
 * 그래서 자식은 이 노드 안에 한 번만 그리고, 노드(DOM) 자체를 새 부모로 옮긴다.
 */
export type PortalNode = { element: HTMLElement }

/**
 * 문서 밖에 떠 있는 빈 노드를 만든다. `display: contents` 라 레이아웃에 상자를 만들지 않는다.
 */
// eslint-disable-next-line react-refresh/only-export-components -- 컴포넌트와 한 쌍으로 쓰는 노드 팩토리라 한 파일에 둔다.
export function createPortalNode(): PortalNode {
  const element = document.createElement('div')
  element.style.display = 'contents'
  element.setAttribute('data-portal-node', '')
  return { element }
}

/**
 * children 을 노드 안에 그린다. React 트리상 위치가 고정이라 OutPortal 이 어디로 옮겨져도
 * children 은 다시 mount 되지 않는다(portal 은 DOM 위치만 노드를 따른다).
 */
export function InPortal({ node, children }: { node: PortalNode; children: ReactNode }): ReactPortal {
  return createPortal(children, node.element)
}

/**
 * 노드를 이 자리(슬롯)에 붙인다. 슬롯이 사라지면 노드를 떼어 문서 밖으로 돌려보낸다.
 * 부모 요소 타입이 바뀌어 슬롯이 새로 만들어져도 노드는 DOM 이동만 일어난다.
 */
export function OutPortal({ node }: { node: PortalNode }) {
  const slotRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    slot.appendChild(node.element)
    return () => {
      // 새 슬롯이 먼저 노드를 가져갔다면(옛 슬롯 정리가 나중) 건드리지 않는다.
      if (node.element.parentNode === slot) slot.removeChild(node.element)
    }
  }, [node])

  return <div ref={slotRef} style={{ display: 'contents' }} data-portal-slot="" />
}

/**
 * id 별 PortalNode 를 안정적으로 돌려주는 훅. 같은 id 에는 렌더가 바뀌어도 같은 노드를 주고,
 * ids 에서 빠진 id 의 노드는 맵에서 지워 메모리에 남지 않게 한다.
 * 주의: 돌려준 get 은 ids 에 들어 있는 id 로만 부른다(빠진 id 로 부르면 새 노드가 만들어져 다음 effect 에서 지워진다).
 */
// eslint-disable-next-line react-refresh/only-export-components -- 컴포넌트와 한 쌍으로 쓰는 훅이라 한 파일에 둔다.
export function usePortalNodes(ids: readonly string[]): (id: string) => PortalNode {
  const nodes = useRef(new Map<string, PortalNode>())

  // 없어진 id 의 노드 정리 — 렌더 중 부수효과를 피하려 effect 에서 한다.
  useEffect(() => {
    const live = new Set(ids)
    for (const id of nodes.current.keys()) {
      if (!live.has(id)) nodes.current.delete(id)
    }
  }, [ids])

  return useCallback((id: string) => {
    let node = nodes.current.get(id)
    if (!node) {
      node = createPortalNode()
      nodes.current.set(id, node)
    }
    return node
  }, [])
}
