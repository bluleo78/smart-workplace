// 채팅 라우트 레이아웃 — 2차 사이드바(채널 목록) + 콘텐츠.
// messaging SSE 구독은 AppLayout(앱 셸)으로 올라갔고, 여기선 연결 상태만 읽어 끊김 배너를 그린다.
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'

import { useMessagingConnection } from '@/hooks/MessagingConnectionContext'

import { ChannelSidebar } from './ChannelSidebar'

// 끊김 배너를 띄우기 전 유예 시간(ms). 첫 연결/일시 끊김 사이의 짧은 구간을 끊김으로
// 오인해 깜빡이지 않도록, 끊김이 이 시간 이상 지속될 때만 배너를 표시한다.
const RECONNECT_GRACE_MS = 800

export function ChatModuleLayout() {
  const { isConnected } = useMessagingConnection()

  // 끊김이 RECONNECT_GRACE_MS 이상 지속될 때만 배너 표시 — 정상 첫 연결의 깜빡임 제거,
  // 실제 끊김(재연결 대기)은 그대로 사용자에게 알림.
  const [showReconnecting, setShowReconnecting] = useState(false)
  useEffect(() => {
    // 연결됨이면 타이머를 걸지 않는다(숨김은 cleanup 이 처리).
    if (isConnected) return
    const t = setTimeout(() => setShowReconnecting(true), RECONNECT_GRACE_MS)
    // 연결 복구/언마운트 시 타이머 해제 + 배너 숨김 → 다음 끊김에 유예를 다시 적용.
    return () => {
      clearTimeout(t)
      setShowReconnecting(false)
    }
  }, [isConnected])

  return (
    <div className="flex h-full min-h-0 flex-col flex-1">
      {/* SSE 재연결 중 배너 — 끊김이 유예 시간 이상 지속될 때만 사용자에게 상태 알림 */}
      {showReconnecting && (
        <div
          data-testid="chat-reconnecting-banner"
          className="flex items-center justify-center bg-warning/10 px-4 py-1.5 text-sm text-warning-foreground"
          role="status"
          aria-live="polite"
        >
          실시간 연결 중...
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <ChannelSidebar />
        <div className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
