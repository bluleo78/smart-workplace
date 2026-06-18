// 채팅 라우트 레이아웃 — 2차 사이드바(채널 목록) + 콘텐츠. messaging SSE 를 여기서 한 번 구독한다.
import { Outlet } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { useMessageStream } from '@/hooks/useMessageStream'

import { ChannelSidebar } from './ChannelSidebar'

export function ChatModuleLayout() {
  const { user } = useAuth()
  const { isConnected } = useMessageStream(user?.id ?? 0) // 채팅 모듈 진입 동안 실시간 스트림 1개 유지

  return (
    <div className="flex h-full min-h-0 flex-col flex-1">
      {/* SSE 재연결 중 배너 — 끊김 시 사용자에게 상태 알림 */}
      {!isConnected && (
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
