// src/components/layout/NodeSlot.tsx
// WP-1468: 페이지 DOM 을 셸 사이로 옮겨 다니게 하는 재부모화 컴포넌트 쌍.
// AppLayout·ResponsiveModuleLayout 이 lg 경계에서 셸(모바일/데스크톱)을 바꿔도 페이지(Outlet)를 다시 마운트하지 않게 하려고 쓴다 —
// 페이지는 PageHost 안에 분기 바깥에서 한 번만 렌더하고, 각 셸은 NodeSlot 으로 그 호스트 DOM 을 자기 자리에 붙인다.
import type { ReactNode } from 'react'

import type { NodeBridge } from './useNodeBridge'

/**
 * 페이지를 담는 호스트. 셸 분기 뒤 형제 자리에 둬서 React 트리 위치가 늘 같게 한다.
 * 바깥 주차 칸은 첫 렌더 때만 호스트를 잠깐 담고(슬롯으로 옮겨지면 빈다), 호스트는 display: contents 라 레이아웃에 끼지 않는다.
 * 첫 자식 표식(hidden span)의 ref 가 페이지 자식들의 레이아웃 이펙트보다 먼저 호스트를 슬롯에 붙인다 — 페이지가 문서에 붙은 DOM 을 잰다.
 */
export function PageHost({ bridge: { anchorCallback }, children }: { bridge: NodeBridge; children: ReactNode }) {
  return (
    <div hidden data-page-parking>
      <div style={{ display: 'contents' }} data-page-host>
        <span hidden ref={anchorCallback} />
        {children}
      </div>
    </div>
  )
}

/** 호스트가 들어올 자리 — display: contents 라 페이지 루트가 슬롯 부모의 flex 자식처럼 배치된다. */
export function NodeSlot({ bridge: { slotCallback } }: { bridge: NodeBridge }) {
  return <div style={{ display: 'contents' }} data-node-slot ref={slotCallback} />
}
