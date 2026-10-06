// 메시지 스크롤 영역 — overflow 컨테이너를 소유하고 하단 고정(useStickToBottom)을 적용한다.
// ChannelPage/DmPage 의 기존 `<div className="min-h-0 flex-1 overflow-y-auto">` 를 대체.
import type { ReactNode } from 'react'

import { useStickToBottom } from '@/hooks/useStickToBottom'
import type { EntryAnchor } from '@/lib/chatEntryAnchor'

interface MessageScrollAreaProps {
  // 하단 고정 트리거 — 보통 마지막 메시지 id + 개수 조합.
  depKey: unknown
  // 최초 진입 시 이 앵커로 스크롤(미읽음 구분선=center, 상단 캐치업 카드=start). 미전달이면 하단.
  initialAnchor?: EntryAnchor
  // 앵커 여부를 아직 판단할 수 없으면 true — 하단으로 확정하지 않고 기다린다(예: DM 상세 미로드).
  anchorPending?: boolean
  children: ReactNode
}

export function MessageScrollArea({ depKey, initialAnchor, anchorPending, children }: MessageScrollAreaProps) {
  const ref = useStickToBottom(depKey, undefined, initialAnchor, anchorPending)
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto" data-testid="message-scroll-area">
      {children}
    </div>
  )
}
