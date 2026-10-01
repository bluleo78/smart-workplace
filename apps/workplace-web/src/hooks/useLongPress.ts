// 길게 누르기(롱프레스) 판정 훅 — 모바일 앱 목록에서 아이콘을 누르고 있으면 액션 메뉴를 연다(안드로이드 런처 관례).
// 메시지 행은 목록 하나가 위임으로 판정한다(useMessageListLongPress). 포인터 이벤트 하나로 터치·마우스·펜을 모두 다루고, 우클릭(contextmenu)도 같은 동작으로 연결한다.
import { type MouseEvent, type PointerEvent, useEffect, useMemo, useRef } from 'react'

/** 길게 누르기로 인정하는 누름 유지 시간(ms) — 안드로이드 기본 long-press timeout 과 비슷한 값. */
const LONG_PRESS_MS = 500
/**
 * 누르는 중 이만큼(px) 넘게 움직이면 스크롤·드래그 의도로 보고 취소한다. 비교는 제곱 거리로(제곱근 불필요).
 * 메시지 목록 위임 길게 누르기(useMessageListLongPress)도 같은 허용치를 쓴다.
 */
export const MOVE_TOLERANCE_SQ = 10 * 10

/**
 * onLongPress 를 길게 누르기/우클릭에 연결하고, 짧은 탭은 onClick 으로 넘긴다.
 * 길게 누르기가 발동한 뒤 손을 떼면 브라우저가 click 을 한 번 더 발생시키므로, 그 click 은 삼켜서
 * "메뉴를 열었는데 앱으로 이동해 버리는" 이중 동작을 막는다.
 * onLongPress 가 없으면(설정처럼 메뉴가 없는 앱) { onClick } 만 돌려준다 — 우클릭은 브라우저 기본 동작.
 * 콜백은 최신값 ref 로 읽어 반환 핸들러가 렌더마다 새로 만들어지지 않는다(안정 참조).
 * 반환값은 대상 요소에 그대로 펼칠(spread) 이벤트 핸들러 묶음.
 */
export function useLongPress(onLongPress: (() => void) | undefined, onClick: () => void) {
  // 최신 콜백 — 핸들러는 한 번만 만들고 호출 시점의 콜백을 읽는다.
  const latest = useRef({ onLongPress, onClick })
  useEffect(() => {
    latest.current = { onLongPress, onClick }
  })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // 이번 누름에서 길게 누르기가 발동했는가 — 바로 뒤따르는 click 1회 억제용.
  // 다음 pointerdown·keydown 에서 초기화해, 우클릭 뒤의 키보드 활성화(Enter/Space → click)는 삼키지 않는다.
  const fired = useRef(false)

  const handlers = useMemo(() => {
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      start.current = null
    }
    const fire = () => {
      fired.current = true
      latest.current.onLongPress?.()
    }
    return {
      cancel,
      press: {
        onPointerDown: (e: PointerEvent) => {
          // 마우스는 주 버튼만 — 우클릭은 contextmenu 경로로 처리한다.
          if (e.pointerType === 'mouse' && e.button !== 0) return
          fired.current = false
          cancel()
          start.current = { x: e.clientX, y: e.clientY }
          timer.current = setTimeout(() => {
            timer.current = null
            fire()
          }, LONG_PRESS_MS)
        },
        onPointerMove: (e: PointerEvent) => {
          const s = start.current
          if (!s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (dx * dx + dy * dy > MOVE_TOLERANCE_SQ) cancel()
        },
        // 손을 뗌·브라우저가 스크롤로 가로챔(pointercancel)·요소 밖으로 나감 → 대기 중이면 취소.
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        // 우클릭·안드로이드의 길게 터치(contextmenu) — 네이티브 메뉴 대신 같은 액션 메뉴(중복 호출돼도 여는 동작은 멱등).
        onContextMenu: (e: MouseEvent) => {
          e.preventDefault()
          cancel()
          fire()
        },
        // 키보드 활성화는 keydown 이 click 보다 먼저 오므로 여기서 플래그를 풀면 그 click 은 정상 이동한다.
        onKeyDown: () => {
          fired.current = false
        },
        onClick: () => {
          if (fired.current) {
            fired.current = false
            return
          }
          latest.current.onClick()
        },
      },
      // 메뉴 없는 앱 — 짧은 탭 이동만.
      plain: { onClick: () => latest.current.onClick() },
    }
  }, [])

  // 언마운트 시 대기 중 타이머 정리(누른 채 화면 이동 등).
  useEffect(() => handlers.cancel, [handlers])

  return onLongPress ? handlers.press : handlers.plain
}
