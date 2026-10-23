// 앱 왼쪽 목록(2차 사이드바)을 감싸 오른쪽 경계선을 끌어 폭을 바꾸게 하는 틀(WP-878). 데스크톱 전용.
// 사이드바 컴포넌트는 손대지 않고 래퍼 CSS 로 <aside> 의 고정 폭(w-56)을 틀 폭에 맞춘다(sidebarListClass 와 같은 방식).
import { type ReactNode, useEffect, useRef, useState } from 'react'

import {
  clampSidebarWidth,
  readSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  sidebarMaxFor,
  writeSidebarWidth,
} from './sidebarWidth'

/** 키보드(←→) 한 번에 바뀌는 폭. */
const KEY_STEP = 16
/** 이만큼(px) 움직여야 끌기로 본다 — 클릭·두 번 누르기의 손떨림이 폭을 저장하지 않게. */
const DRAG_THRESHOLD = 2

/**
 * widthKey 별로 폭을 기억한다(앱마다 따로). 끄는 동안엔 상태만 바꾸고 손을 뗄 때 한 번 저장한다.
 * 경계선을 두 번 누르면 기본 폭으로 돌아간다. 손잡이는 분할선(role=separator)이라 Tab 으로 잡고 ←→·Home·End 로도 조절한다.
 * 좁은 앱 영역에선 CSS 상한(앱 영역의 40%)이 저장 폭보다 먼저 걸려 본문 자리를 남긴다 — 저장값은 그대로 두고 표시만 줄이며,
 * 새로 끌거나 키보드로 바꾼 폭은 그 상한 안에서만 저장한다.
 */
export function ResizableSidebar({ widthKey, children }: { widthKey: string; children: ReactNode }) {
  const [width, setWidth] = useState(() => readSidebarWidth(widthKey))
  const frameRef = useRef<HTMLDivElement>(null)
  // 진행 중인 끌기를 끝내는 함수 — 끄는 도중 화면이 바뀌어(언마운트) pointerup 이 오지 않아도 body 스타일을 되돌리고 끈 폭을 저장한다.
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])
  // 지금 화면의 상한(앱 영역 = 틀의 부모 폭 기준)과 실제로 보이는 폭. 끌기·키보드는 보이는 폭에서 시작해 상한 안에서 바꾼다.
  const maxNow = () => {
    const container = frameRef.current?.parentElement?.clientWidth
    return container ? sidebarMaxFor(container) : SIDEBAR_MAX_WIDTH
  }
  const visibleWidth = () => clampSidebarWidth(frameRef.current?.getBoundingClientRect().width ?? width, maxNow())

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

  // 왼쪽에 붙은 목록이라 폭 = 시작 폭 + 마우스 이동량. 앱 레일 펼침 여부와 무관하게 맞는다.
  // 포인터를 손잡이에 캡처해, 메일 본문·미리보기 iframe 위에서 움직이거나 손을 떼도 이벤트를 놓치지 않는다.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const max = maxNow()
    const startWidth = visibleWidth()
    let last = startWidth
    let moved = false
    let frame = 0
    // 끄는 동안 본문(노트 편집기 등) 글자가 선택되지 않게, 커서가 경계선을 벗어나도 리사이즈 커서를 유지한다.
    const body = document.body.style
    const prevCursor = body.cursor
    const prevSelect = body.userSelect
    body.cursor = 'col-resize'
    body.userSelect = 'none'
    // 무거운 본문(노트 편집기·캘린더 격자) 재배치를 줄이려 폭 갱신은 프레임당 한 번.
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return
      moved = true
      last = clampSidebarWidth(startWidth + ev.clientX - startX, max)
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        setWidth(last)
      })
    }
    const cleanup = () => {
      cancelAnimationFrame(frame)
      body.cursor = prevCursor
      body.userSelect = prevSelect
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('lostpointercapture', up)
      endDrag.current = null
    }
    // 끈 폭을 저장한다(언마운트 때도). 움직이지 않은 클릭은 상태·저장값을 건드리지 않는다.
    const finish = () => {
      cleanup()
      if (moved && last !== startWidth) writeSidebarWidth(widthKey, last)
    }
    function up() {
      finish()
      if (moved) setWidth(last)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    // 캡처가 풀리면(pointercancel·창 전환 등) 거기서 끌기를 끝낸다.
    handle.addEventListener('lostpointercapture', up)
    endDrag.current = finish
  }

  // 폭을 바꾸고 바로 저장한다(두 번 누르기·키보드).
  const commit = (next: number) => {
    setWidth(next)
    writeSidebarWidth(widthKey, next)
  }

  // 분할선 키보드 관례(WAI-ARIA window splitter): ←→ 한 칸, Home 최소, End 그 화면의 최대.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const max = maxNow()
    const next =
      e.key === 'ArrowLeft' ? visibleWidth() - KEY_STEP
      : e.key === 'ArrowRight' ? visibleWidth() + KEY_STEP
      : e.key === 'Home' ? SIDEBAR_MIN_WIDTH
      : e.key === 'End' ? max
      : null
    if (next === null) return
    e.preventDefault()
    commit(clampSidebarWidth(next, max))
  }

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
      {/* 경계선 손잡이 — 경계선(border-r) 위에 걸쳐 좌우로 잡기 쉽게 둔다. AI 사이드 패널 손잡이와 같은 모양.
          보이는 선은 4px, 잡는 영역은 투명 ::after 로 좌우 4px 씩 넓히고, touch-none 으로 터치 끌기가 화면 스크롤로 가로채이지 않게 한다. */}
      <div
        data-testid="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="목록 폭 조절"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={Math.max(SIDEBAR_MIN_WIDTH, limit)}
        aria-valuenow={clampSidebarWidth(width, limit)}
        tabIndex={0}
        title="끌어서 폭 조절 · 두 번 눌러 원래 폭으로"
        onPointerDown={onPointerDown}
        onDoubleClick={() => commit(SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
        className="absolute -right-0.5 top-0 z-10 h-full w-1 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:-inset-x-1 after:content-[''] hover:bg-primary/20 focus-visible:bg-primary/40 active:bg-primary/30"
      />
    </div>
  )
}
