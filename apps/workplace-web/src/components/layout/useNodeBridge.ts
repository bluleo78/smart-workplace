// src/components/layout/useNodeBridge.ts
// WP-1468: PageHost(페이지 DOM 호스트)와 NodeSlot(셸 안의 자리)을 이어 주는 다리. (react-refresh 규칙 때문에 컴포넌트 파일과 분리)
// WP-1488: 브라우저는 노드를 떼었다 붙일 때 하위 스크롤 오프셋을 0 으로 잃는다. 호스트를 옮기기 전에 저장하고 옮긴 뒤 복원한다.
import { useState } from 'react'

import { captureScroll, restoreScroll, type ScrollSnapshot } from './scrollSnapshot'

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
    // 셸 전환 때 잃을 스크롤 오프셋 — 옮길 때 꺼내 쓰고 비운다.
    let saved: ScrollSnapshot | null = null
    // 둘 다 있고 아직 슬롯 안이 아니면 옮긴다(appendChild 는 기존 부모에서 떼어 이동).
    const attach = () => {
      if (slot && host && host.parentNode !== slot) {
        slot.appendChild(host)
        const snap = saved
        saved = null
        // 복원은 같은 커밋의 ref 콜백이 모두 끝난 뒤(페인트 전 마이크로태스크)에 한다 — 중첩 브리지(AppLayout 안의
        // ResponsiveModuleLayout)에서는 바깥 attach 시점에 안쪽 호스트가 아직 다시 붙기 전이라 그 안 요소를 복원할 수 없다.
        if (snap?.length) queueMicrotask(() => restoreScroll(snap))
      }
    }
    return {
      slotCallback: (el) => {
        if (!el) {
          // 옛 슬롯이 해제될 때 — React 는 같은 커밋에서 옛 ref 를 새 ref 보다 먼저, 지워질 서브트리의 DOM 을 떼기 전에 해제한다.
          // 그래서 스냅샷은 여기 한 곳에서만 잡는다(아직 스크롤이 남아 있다). 첫 마운트(주차 칸)에는 옛 슬롯이 없어 훑지 않는다.
          if (host?.isConnected) saved = captureScroll(host)
          slot = null
          return
        }
        slot = el
        attach()
        // 옮기지 않고 같은 슬롯에 다시 붙은 경우(StrictMode 재생 등) 남은 스냅샷은 낡은 것이다 — 비운다.
        saved = null
      },
      anchorCallback: (el) => {
        if (el) {
          host = el.parentElement
          attach()
        } else {
          // PageHost 가 내려갈 때 — 호스트가 슬롯으로 옮겨가 있으면 React 가 주차 칸만 지우므로 직접 치운다.
          host?.remove()
          host = null
          saved = null // 내려간 페이지의 스크롤은 다음 마운트에 복원하지 않는다
        }
      },
    }
  })
  return bridge
}
