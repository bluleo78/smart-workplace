// 채팅 모듈 첫 진입(채널/DM 미선택) — 빈 상태 + 새 메시지 CTA.
import { MessagesSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { Button } from '@/components/ui/button'

export default function ChannelListPage() {
  return (
    <div className="flex h-full items-center justify-center" data-testid="channel-empty">
      {/* 채널을 고르기 전 빈 화면에도 화면 이름을 숨은 h1 로 둔다 — 스크린리더 제목 이동용(WP-816). */}
      <h1 className="sr-only">대화</h1>
      <ChatEmptyState
        icon={<MessagesSquare className="h-10 w-10" />}
        title="대화를 시작해 보세요"
        description="왼쪽에서 채널을 선택하거나 새 메시지로 다이렉트 메시지를 시작할 수 있어요."
        action={
          <Button asChild size="sm" data-testid="channel-empty-new-message">
            <Link to="/chat/new">새 메시지</Link>
          </Button>
        }
      />
    </div>
  )
}
