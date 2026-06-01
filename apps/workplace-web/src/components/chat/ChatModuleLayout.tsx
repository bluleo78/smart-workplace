// 채팅 라우트 레이아웃 — 2차 사이드바(채널 목록) + 콘텐츠. messaging SSE 를 여기서 한 번 구독한다.
import { Outlet } from 'react-router-dom'

import { useMessageStream } from '@/hooks/useMessageStream'

import { ChannelSidebar } from './ChannelSidebar'

export function ChatModuleLayout() {
  useMessageStream() // 채팅 모듈 진입 동안 실시간 스트림 1개 유지
  return (
    <div className="flex h-full min-h-0 flex-1">
      <ChannelSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
