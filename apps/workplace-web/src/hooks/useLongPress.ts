// 길게 누르기(롱프레스) 판정 훅 — 모바일 앱 목록에서 아이콘을 누르고 있으면 액션 메뉴를 연다(안드로이드 런처 관례).
// 포인터 이벤트 하나로 터치·마우스·펜을 모두 다루고, 우클릭(contextmenu)도 같은 동작으로 연결한다.
import { type MouseEvent, type PointerEvent, useCallback, useEffect, useRef } from 'react'

/** 길게 누르기로 인정하는 누름 유지 시간(ms) — 안드로이드 기본 long-press timeout 과 비슷한 값. */
const LONG_PRESS_MS = 500
/** 누르는 중 이만큼(px) 넘게 움직이면 스크롤·드래그 의도로 보고 취소한다. */
const MOVE_TOLERANCE = 10

/**
 * onLongPress 를 길게 누르기/우클릭에 연결하고, 짧은 탭은 onClick 으로 넘긴다.
 * 길게 누르기가 발동한 뒤 손을 떼면 브라우저가 click 을 한 번 더 발생시키므로, 그 click 은 삼켜서
 * "메뉴를 열었는데 앱으로 이동해 버리는" 이중 동작을 막는다.
 * 반환값은 대상 요소에 그대로 펼칠(spread) 이벤트 핸들러 묶음.
 */
export function useLongPress(onLongPress: () => void, onClick: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // 이번 누름에서 길게 누르기가 발동했는가 — 뒤따르는 click 억제용. 다음 pointerdown 에서 초기화.
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])

  // 언마운트 시 대기 중 타이머 정리(누른 채 화면 이동 등).
  useEffect(() => cancel, [cancel])

  return {
    onPointerDown: (e: PointerEvent) => {
      // 마우스는 주 버튼만 — 우클릭은 contextmenu 경로로 처리한다.
      if (e.pointerType === 'mouse' && e.button !== 0) return
      fired.current = false
      cancel()
      start.current = { x: e.clientX, y: e.clientY }
      timer.current = setTimeout(() => {
        timer.current = null
        fired.current = true
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel()
    },
    // 손을 뗌·브라우저가 스크롤로 가로챔(pointercancel)·요소 밖으로 나감 → 대기 중이면 취소.
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // 우클릭·안드로이드의 길게 터치(contextmenu) — 네이티브 메뉴 대신 같은 액션 메뉴(중복 호출돼도 여는 동작은 멱등).
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      cancel()
      fired.current = true
      onLongPress()
    },
    onClick: () => {
      if (fired.current) {
        fired.current = false
        return
      }
      onClick()
    },
  }
}
