// 메시지 목록 길게 누르기(위임) — 모바일 터치 셸에서 행을 길게 누르면 목록이 가진 작업 시트를 연다.
// 왜 행마다가 아니라 목록 하나에: 행마다 useLongPress(타이머·ref·핸들러 묶음)를 두면 메시지 수만큼 생기고,
// 행이 탭 노출(useToolbarReveal)과 pointerup 을 나눠 쓰느라 핸들러를 손으로 합쳐야 했다. 목록 컨테이너 하나가
// pointer 이벤트를 받아 closest('[data-message-id]') 로 대상 행을 찾으면 타이머·발동 표식이 목록당 한 벌이다.
// 우클릭·안드로이드 길게 터치(contextmenu)도 같은 시트로 연결하고, 발동 직후의 click 은 캡처 단계에서 삼킨다
// (멘션 칩·링크·이미지·답글 링크 같은 자식 click 이 함께 실행되는 이중 동작 방지). 짧은 탭은 손대지 않는다.
import { type MouseEvent, type PointerEvent, type SyntheticEvent, useEffect, useMemo, useRef } from 'react'

import { MOVE_TOLERANCE_SQ } from '@/hooks/useLongPress'

/** 메시지 행 길게 누르기 판정 시간(ms) — 앱 아이콘(500ms)보다 조금 짧게, 대화 중 빠른 조작용. */
const MESSAGE_LONG_PRESS_MS = 450

/** 목록 컨테이너에 펼칠 핸들러 묶음. 비활성(데스크톱)이면 빈 객체 — 우클릭은 브라우저 기본 동작 그대로. */
export interface MessageListLongPressHandlers {
  onPointerDown?: (e: PointerEvent) => void
  onPointerMove?: (e: PointerEvent) => void
  onPointerUp?: () => void
  onPointerCancel?: () => void
  onPointerLeave?: () => void
  onContextMenu?: (e: MouseEvent) => void
  onKeyDown?: () => void
  onClickCapture?: (e: MouseEvent) => void
}

/**
 * @param enabled 터치 셸일 때만 true — 아니면 핸들러를 하나도 달지 않는다.
 * @param canOpen 발동 시점에 이 id 의 시트를 열 수 있는가(목록에 있음·수정 중 아님·작업이 하나라도 있음).
 *   false 면 타이머도 걸지 않고 contextmenu 도 막지 않는다 — 수정 중 에디터의 네이티브 붙여넣기 메뉴가 살아 있게(C2).
 * @param onOpen 시트를 연다.
 */
export function useMessageListLongPress(
  enabled: boolean,
  canOpen: (id: number) => boolean,
  onOpen: (id: number) => void,
): MessageListLongPressHandlers {
  // 최신 콜백 — 핸들러는 한 번만 만들고 호출 시점의 콜백을 읽는다.
  const latest = useRef({ canOpen, onOpen })
  useEffect(() => {
    latest.current = { canOpen, onOpen }
  })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // 이번 누름에서 발동했는가 — 바로 뒤따르는 click 1회 억제용. 다음 pointerdown·keydown 에서 초기화한다.
  const fired = useRef(false)

  const handlers = useMemo(() => {
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      start.current = null
    }
    // 이벤트가 이 목록 DOM 안에서 났는가. React 이벤트는 포털을 React 트리 기준으로 거슬러 오르므로,
    // 목록이 렌더한 작업 시트(포털) 안의 탭·클릭도 여기 도착한다 — 그건 목록 행 이벤트가 아니므로 무시한다.
    const inside = (e: SyntheticEvent) => e.target instanceof Node && e.currentTarget.contains(e.target)
    /** 이벤트 대상의 메시지 행 id. 행이 아니거나·미전송(음수)·열 수 없으면 null. */
    const targetId = (e: SyntheticEvent): number | null => {
      if (!inside(e)) return null
      const row = (e.target as Element).closest?.('[data-message-id]')
      if (!row || !e.currentTarget.contains(row)) return null
      const id = Number(row.getAttribute('data-message-id'))
      return Number.isFinite(id) && id >= 0 && latest.current.canOpen(id) ? id : null
    }
    const fire = (id: number) => {
      fired.current = true
      latest.current.onOpen(id)
    }
    return {
      cancel,
      press: {
        onPointerDown: (e: PointerEvent) => {
          if (!inside(e)) return
          // 마우스는 주 버튼만 — 우클릭은 contextmenu 경로로 처리한다.
          if (e.pointerType === 'mouse' && e.button !== 0) return
          fired.current = false
          cancel()
          const id = targetId(e)
          if (id === null) return
          start.current = { x: e.clientX, y: e.clientY }
          timer.current = setTimeout(() => {
            timer.current = null
            // 누르는 사이 수정이 시작됐거나 메시지가 사라졌을 수 있어 발동 시점에 한 번 더 확인한다.
            if (latest.current.canOpen(id)) fire(id)
          }, MESSAGE_LONG_PRESS_MS)
        },
        onPointerMove: (e: PointerEvent) => {
          const s = start.current
          if (!s) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (dx * dx + dy * dy > MOVE_TOLERANCE_SQ) cancel()
        },
        // 손을 뗌·브라우저가 스크롤로 가로챔(pointercancel)·목록 밖으로 나감 → 대기 중이면 취소.
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        // 안드로이드의 길게 터치·우클릭 — 대상 행을 먼저 판정하고, 열 수 있을 때만 네이티브 메뉴를 막는다.
        onContextMenu: (e: MouseEvent) => {
          const id = targetId(e)
          if (id === null) return
          e.preventDefault()
          cancel()
          fire(id) // 타이머 발동과 겹쳐도 여는 동작은 멱등.
        },
        // 키보드 활성화(스크린리더용 "메시지 작업" 버튼 등)는 keydown 이 click 보다 먼저 오므로 여기서 표식을 풀어 삼키지 않는다.
        onKeyDown: () => {
          fired.current = false
        },
        // 발동 직후 click 은 캡처 단계에서 전파·기본 동작(링크 이동)까지 끊는다. 시트(포털) 안 click 은 건드리지 않는다.
        onClickCapture: (e: MouseEvent) => {
          if (!inside(e) || !fired.current) return
          fired.current = false
          e.preventDefault()
          e.stopPropagation()
        },
      },
    }
  }, [])

  // 언마운트 시 대기 중 타이머 정리(누른 채 화면 이동 등).
  useEffect(() => handlers.cancel, [handlers])

  return enabled ? handlers.press : {}
}
