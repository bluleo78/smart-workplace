// 앱 왼쪽 목록(2차 사이드바)을 감싸 오른쪽 경계선을 끌어 폭을 바꾸게 하는 틀(WP-878). 데스크톱 전용.
// 사이드바 컴포넌트는 손대지 않고 래퍼 CSS 로 <aside> 의 고정 폭(w-56)을 틀 폭에 맞춘다(sidebarListClass 와 같은 방식).
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { resizeHandleClass, useResizeHandle } from '@/hooks/useResizeHandle'
import { clampWidth } from '@/lib/clampWidth'

import {
  readSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarMaxFor,
  writeSidebarWidth,
} from './sidebarWidth'

/**
 * widthKey 별로 폭을 기억한다(앱마다 따로). 끌기·키보드·두 번 누르기는 공용 손잡이 훅(hooks/useResizeHandle)이 맡고,
 * 여기선 폭 상태와 앱별 저장만 다룬다.
 * 좁은 앱 영역에선 CSS 상한(앱 영역의 40%)이 저장 폭보다 먼저 걸려 본문 자리를 남긴다 — 저장값은 그대로 두고 표시만 줄이며,
 * 새로 끌거나 키보드로 바꾼 폭은 그 상한 안에서만 저장한다.
 */
export function ResizableSidebar({ widthKey, children }: { widthKey: string; children: ReactNode }) {
  const [width, setWidth] = useState(() => readSidebarWidth(widthKey))
  const frameRef = useRef<HTMLDivElement>(null)
  // 지금 화면의 상한(앱 영역 = 틀의 부모 폭 기준). 끌기·키보드는 틀의 보이는 폭에서 시작해 이 상한 안에서 바꾼다.
  const maxNow = () => {
    const container = frameRef.current?.parentElement?.clientWidth
    return container ? sidebarMaxFor(container) : SIDEBAR_MAX_WIDTH
  }

  // 그 화면의 상한을 상태로도 따라간다 — 손잡이의 aria-valuemax·aria-valuenow 가 저장값(480 등)이 아니라
  // 보이는 폭·닿을 수 있는 최대를 알리게(WP-897). 앱 영역(틀의 부모) 폭이 바뀔 때(창 크기·AI 패널 열고 닫기)마다 다시 잰다.
  const [limit, setLimit] = useState(SIDEBAR_MAX_WIDTH)
  useEffect(() => {
    const container = frameRef.current?.parentElement
    if (!container) return
    const measure = () => setLimit(sidebarMaxFor(container.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const handleProps = useResizeHandle({
    edge: 'right',
    width,
    min: SIDEBAR_MIN_WIDTH,
    max: SIDEBAR_MAX_WIDTH,
    cap: maxNow,
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    onPreview: setWidth,
    // 확정 폭 저장 — writeSidebarWidth 는 기본 폭이면 키를 지운다.
    onCommit: (next) => {
      setWidth(next)
      writeSidebarWidth(widthKey, next)
    },
    label: '목록 폭 조절',
  })

  return (
    <div
      ref={frameRef}
      data-testid="sidebar-frame"
      style={{ width }}
      // [&>aside]: 사이드바 루트 <aside> 의 w-56 을 틀 폭으로 덮는다(자식 선택자라 .w-56 보다 우선).
      // max-w-[40%]: 앱 영역(부모 flex 줄)의 40% — SIDEBAR_MAX_RATIO 와 같은 값.
      className="relative flex max-w-[40%] shrink-0 [&>aside]:w-full [&>aside]:min-w-0"
    >
      {children}
      {/* 경계선 손잡이 — 경계선(border-r) 위에 걸쳐 좌우로 잡기 쉽게 둔다(AI 사이드 패널 손잡이와 같은 훅·모양). */}
      {/* aria-valuemax·valuenow 는 훅 기본값(고정 최대·저장 폭) 대신 이 화면의 상한·보이는 폭으로 덮는다(WP-897). */}
      <div
        data-testid="sidebar-resize-handle"
        {...handleProps}
        aria-valuemax={Math.max(SIDEBAR_MIN_WIDTH, limit)}
        aria-valuenow={clampWidth(width, SIDEBAR_MIN_WIDTH, limit)}
        className={`${resizeHandleClass} -right-0.5`}
      />
    </div>
  )
}
