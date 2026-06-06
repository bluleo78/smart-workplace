// 메시지 스크롤 영역 — overflow 컨테이너를 소유하고 하단 고정(useStickToBottom)을 적용한다.
// ChannelPage/DmPage 의 기존 `<div className="min-h-0 flex-1 overflow-y-auto">` 를 대체.
import type { ReactNode } from 'react'

import { useStickToBottom } from '@/hooks/useStickToBottom'

interface MessageScrollAreaProps {
  // 하단 고정 트리거 — 보통 마지막 메시지 id + 개수 조합.
  depKey: unknown
  children: ReactNode
}

export function MessageScrollArea({ depKey, children }: MessageScrollAreaProps) {
  const ref = useStickToBottom(depKey)
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto" data-testid="message-scroll-area">
      {children}
    </div>
  )
}
