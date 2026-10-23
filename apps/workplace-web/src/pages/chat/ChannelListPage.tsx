// 채팅 모듈 첫 진입(채널/DM 미선택) — 빈 상태 + 새 메시지 CTA.
// 채널 목록 첫 조회가 실패하면 「대화를 시작해 보세요」 대신 실패 안내 + 다시 시도(WP-865) — 대화가 없는 것처럼 보이지 않게.
import { MessagesSquare } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { LoadErrorState } from '@/components/LoadErrorState'
import { Button } from '@/components/ui/button'
import { useMyChannels } from '@/hooks/queries/useMyChannels'

export default function ChannelListPage() {
  // 사이드바와 같은 키라 요청은 한 번만 간다.
  const channels = useMyChannels()
  return (
    <div className="flex h-full items-center justify-center" data-testid="channel-empty">
      {/* 채널을 고르기 전 빈 화면에도 화면 이름을 숨은 h1 로 둔다 — 스크린리더 제목 이동용(WP-816). */}
      <h1 className="sr-only">대화</h1>
      {channels.isLoadingError ? (
        <LoadErrorState
          title="대화 목록을 불러오지 못했습니다"
          queries={[channels]}
          testId="channel-load-error"
        />
      ) : (
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
      )}
    </div>
  )
}
