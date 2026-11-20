// 채널·DM 화면이 함께 쓰는 「열린 스레드」 판정(WP-207, WP-1083).
// 열린 스레드 = URL ?thread(상태의 단일 원천). 화면 안 「답글」도 push 라 시스템 뒤로가기가 스레드만 닫는다.
// 인박스 카드(ThreadsInboxPage)는 ?thread 로 push(마크 없음) → 닫기 = 인박스로 -1. 푸시 알림 콜드 진입은 닫기 = ?thread 만 지우고 화면에 남는다
// (useHistoryParam 규칙 3).
// 닫힘 초점 복귀(WP-1804)도 여기서 한다 — 열림 상태(threadShown)를 가진 곳이라 「진짜 닫힘」과 「스레드 전환」을 가를 수 있다.
import { useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { focusLost } from '@/hooks/useRestoreFocusOnExit'
import { parseId } from '@/lib/historyParam'
import type { MessageResponse } from '@/types/messaging'

/**
 * 열린 스레드의 루트 메시지를 찾는다 — 화면 메시지 캐시에서 찾되, 없으면 navigate state(인박스 카드가 넘긴 rootMessage)를 쓴다.
 * 패널이 실제로 그려질 때만(루트를 찾았을 때만) 모바일 탭바를 숨긴다 — ?thread 만 보고 숨기면 첫 페이지에 없는 루트·삭제된 루트에서
 * 빈 전체폭 화면이 된다.
 */
export function useOpenThread(messages: MessageResponse[]) {
  const location = useLocation()
  const historyParam = useHistoryParam('thread')
  // 스레드를 키보드로 연 요소(「스레드」 단추·「답글 N개」 링크) — 칸이 닫히면 초점을 여기로 돌려준다(WP-1804).
  const openerRef = useRef<HTMLElement | null>(null)
  const { value, open } = historyParam
  // 호출부(ChannelPage·DmPage)에는 같은 모양(value·open·close)을 돌려주되, open 이 연 요소를 먼저 기억한다.
  const openWithOpener = useCallback(
    (id: string) => {
      openerRef.current = keyboardFocusedElement()
      open(id)
    },
    [open],
  )
  const threadParam = { ...historyParam, open: openWithOpener }
  const openThreadId = parseId(value)
  const stateParent = (location.state as { threadParent?: MessageResponse } | null)?.threadParent
  const openThreadParent =
    openThreadId != null
      ? messages.find((m) => m.id === openThreadId) ??
        (stateParent && stateParent.id === openThreadId ? stateParent : null)
      : null
  const threadShown = openThreadParent != null
  useHideTabBar(threadShown)
  useReturnFocusOnThreadClose(threadShown, openerRef)
  return { threadParam, openThreadParent, threadShown }
}

/**
 * 지금 키보드 초점(초점 링, :focus-visible)이 있는 요소 — 없으면 null.
 * 마우스로 연 스레드는 초점 링이 없으므로 기억하지 않는다(닫을 때 마우스 사용자에게 초점 링을 띄우지 않으려고).
 */
function keyboardFocusedElement(): HTMLElement | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body) return null
  try {
    return el.matches(':focus-visible') ? el : null
  } catch {
    // :focus-visible 을 모르는 브라우저는 키보드 여부를 알 수 없으니 기억하지 않는다.
    return null
  }
}

/**
 * 스레드 칸이 실제로 닫힐 때(threadShown true → false)만, 초점이 갈 곳을 잃었으면 연 요소로 돌린다(WP-1804).
 * 칸은 히스토리 이동으로 닫혀 ✕ 가 사라지면서 초점이 body 로 빠진다 — 키보드 사용자의 다음 Tab 이 화면 처음부터 시작하던 문제.
 * effect 는 ✕ 를 지운 커밋 뒤에 돌므로 따로 프레임을 기다리지 않는다. 화면째 언마운트되면(인박스로 -1 이동) effect 가 돌지 않아 떠난 화면을 건드리지 않는다.
 * 스레드 전환은 threadShown 이 계속 true 라, StrictMode 이중 실행은 전환이 없어 아무것도 하지 않는다.
 * 닫힐 때마다 기억을 지운다 — 앞으로가기로 다시 열린 칸(open 없이)을 닫을 때 낡은 요소로 돌리지 않게.
 * 사용자가 다른 곳에 초점을 두고 닫았으면(focusLost 아님) 그 자리를 빼앗지 않는다. 연 요소가 사라졌으면(isConnected 아님) 건너뛴다.
 */
function useReturnFocusOnThreadClose(threadShown: boolean, openerRef: { current: HTMLElement | null }) {
  const wasShown = useRef(threadShown)
  useEffect(() => {
    const closed = wasShown.current && !threadShown
    wasShown.current = threadShown
    if (!closed) return
    const opener = openerRef.current
    openerRef.current = null
    if (opener && opener.isConnected && focusLost()) opener.focus({ preventScroll: true })
  }, [threadShown, openerRef])
}
