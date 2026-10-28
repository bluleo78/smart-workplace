// 채널·DM 화면이 함께 쓰는 「열린 스레드」 판정(WP-207, WP-1083).
// 열린 스레드 = URL ?thread(상태의 단일 원천). 화면 안 「답글」도 push 라 시스템 뒤로가기가 스레드만 닫는다.
// 인박스 카드(ThreadsInboxPage)는 ?thread 로 push(마크 없음) → 닫기 = 인박스로 -1. 푸시 알림 콜드 진입은 닫기 = ?thread 만 지우고 화면에 남는다
// (useHistoryParam 규칙 3).
import { useLocation } from 'react-router-dom'

import { useHideTabBar } from '@/components/mobile/MobileChromeContext'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { parseId } from '@/lib/historyParam'
import type { MessageResponse } from '@/types/messaging'

/**
 * 열린 스레드의 루트 메시지를 찾는다 — 화면 메시지 캐시에서 찾되, 없으면 navigate state(인박스 카드가 넘긴 rootMessage)를 쓴다.
 * 패널이 실제로 그려질 때만(루트를 찾았을 때만) 모바일 탭바를 숨긴다 — ?thread 만 보고 숨기면 첫 페이지에 없는 루트·삭제된 루트에서
 * 빈 전체폭 화면이 된다.
 */
export function useOpenThread(messages: MessageResponse[]) {
  const location = useLocation()
  const threadParam = useHistoryParam('thread')
  const openThreadId = parseId(threadParam.value)
  const stateParent = (location.state as { threadParent?: MessageResponse } | null)?.threadParent
  const openThreadParent =
    openThreadId != null
      ? messages.find((m) => m.id === openThreadId) ??
        (stateParent && stateParent.id === openThreadId ? stateParent : null)
      : null
  const threadShown = openThreadParent != null
  useHideTabBar(threadShown)
  return { threadParam, openThreadParent, threadShown }
}
