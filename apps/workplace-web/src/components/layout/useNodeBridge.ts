// src/components/layout/useNodeBridge.ts
// WP-1468: PageHost(페이지 DOM 호스트)와 NodeSlot(셸 안의 자리)을 이어 주는 다리. (react-refresh 규칙 때문에 컴포넌트 파일과 분리)
import { useState } from 'react'

/** PageHost·NodeSlot 이 공유하는 ref 콜백 쌍. 둘 중 나중에 도착한 쪽이 호스트를 슬롯으로 옮긴다. */
export interface NodeBridge {
  /** NodeSlot 의 ref — 슬롯이 마운트(셸 교체 포함)되면 호스트를 그 안으로 옮겨 붙인다. */
  slotCallback: (el: HTMLElement | null) => void
  /** PageHost 안 첫 자식(표식)의 ref — 표식의 부모가 호스트다. 페이지 자식들의 레이아웃 이펙트보다 먼저 실행된다. */
  anchorCallback: (el: HTMLElement | null) => void
}

/**
 * 컴포넌트 수명 동안 같은 NodeBridge 를 돌려준다.
 * 호스트는 포털이 아니라 React 가 그린 일반 DOM 이다 — 포털 컨테이너로 두면 React 가 #root 위임에서 그 하위 이벤트를 버려
 * #root 밑에 DOM 을 붙이는 floating 요소(tippy 등)의 onClick 이 죽는다. 그래서 호스트를 appendChild 로 옮기기만 한다.
 */
export function useNodeBridge(): NodeBridge {
  const [bridge] = useState<NodeBridge>(() => {
    let slot: HTMLElement | null = null
    let host: HTMLElement | null = null
    // 둘 다 있고 아직 슬롯 안이 아니면 옮긴다(appendChild 는 기존 부모에서 떼어 이동).
    const attach = () => {
      if (slot && host && host.parentNode !== slot) slot.appendChild(host)
    }
    return {
      slotCallback: (el) => {
        slot = el
        attach()
      },
      anchorCallback: (el) => {
        if (el) {
          host = el.parentElement
          attach()
        } else {
          // PageHost 가 내려갈 때 — 호스트가 슬롯으로 옮겨가 있으면 React 가 주차 칸만 지우므로 직접 치운다.
          host?.remove()
          host = null
        }
      },
    }
  })
  return bridge
}
