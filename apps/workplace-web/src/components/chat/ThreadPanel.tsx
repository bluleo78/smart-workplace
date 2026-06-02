// 우측 스레드 패널 — 부모 메시지 + 답글 목록 + 답글 컴포저. 부모는 채널 메시지 캐시에서 찾고,
// 답글은 useThreadReplies. 답글 작성은 useCreateReply(낙관적).
import { X } from 'lucide-react'

import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import type { MentionCandidate } from '@/components/mentions/types'
import { Button } from '@/components/ui/button'
import { useCreateReply } from '@/hooks/queries/useCreateReply'
import { useThreadReplies } from '@/hooks/queries/useThreadReplies'
import type { MessageResponse, UserKind } from '@/types/messaging'

interface ThreadPanelProps {
  channelId: number
  parent: MessageResponse
  members: MentionCandidate[]
  me: { id: number; name: string; kind: UserKind }
  archived: boolean
  onClose: () => void
}

export function ThreadPanel({ channelId, parent, members, me, archived, onClose }: ThreadPanelProps) {
  const { data } = useThreadReplies(parent.id)
  // 스레드 답글은 ASC 페이지. MessageList 가 내부에서 reverse 하므로 reverse 해서 넘긴다(원복).
  const replies = (data?.pages.flatMap((p) => p.items) ?? []).slice().reverse()
  const reply = useCreateReply(channelId, parent.id, me)

  return (
    <div
      className="flex h-full min-h-0 w-96 flex-col border-l"
      data-testid="thread-panel"
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">스레드</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="스레드 닫기"
          data-testid="thread-close"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 부모 메시지(단건) — onOpenThread 미전달 → 답글/링크 비노출. disableMarkRead 로 채널 watermark 미전진. */}
        <MessageList
          messages={[parent]}
          channelId={channelId}
          currentUserId={me.id}
          members={members}
          disableMarkRead
        />
        <div className="border-t" />
        {/* 답글 목록 — 답글 id 로 채널 watermark 가 전진하면 안 되므로 mark-read 비활성. */}
        <MessageList
          messages={replies}
          channelId={channelId}
          currentUserId={me.id}
          members={members}
          disableMarkRead
        />
      </div>
      <MessageComposer
        members={members}
        disabled={archived}
        onSend={(body) => reply.mutate(body)}
      />
    </div>
  )
}
