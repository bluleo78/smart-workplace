// 우측 스레드 패널 — 부모 메시지 + 답글 목록 + 답글 컴포저. 부모는 채널 메시지 캐시에서 찾고,
// 답글은 useThreadReplies. 답글 작성은 useCreateReply(낙관적).
import { MessageSquare, X } from 'lucide-react'
import { useEffect } from 'react'

import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageList } from '@/components/chat/MessageList'
import type { MentionCandidate } from '@/components/mentions/types'
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar'
import { Button } from '@/components/ui/button'
import { useCreateReply } from '@/hooks/queries/useCreateReply'
import { useMarkThreadRead } from '@/hooks/queries/useMarkThreadRead'
import { useThreadReplies } from '@/hooks/queries/useThreadReplies'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import type { MessageResponse, UserKind } from '@/types/messaging'

interface ThreadPanelProps {
  channelId: number
  /** 모바일 상세 헤더 보조 표기(#채널명) — 채널 컬럼을 숨겨 맥락이 사라지므로 헤더에 남긴다(WP-207). */
  channelName: string
  parent: MessageResponse
  members: MentionCandidate[]
  me: { id: number; name: string; kind: UserKind }
  archived: boolean
  onClose: () => void
}

export function ThreadPanel({ channelId, channelName, parent, members, me, archived, onClose }: ThreadPanelProps) {
  const isMobile = useIsMobile()
  const { data } = useThreadReplies(parent.id)
  // 스레드 답글은 ASC 페이지. MessageList 가 내부에서 reverse 하므로 reverse 해서 넘긴다(원복).
  const replies = (data?.pages.flatMap((p) => p.items) ?? []).slice().reverse()
  const reply = useCreateReply(channelId, parent.id, me)
  const markThreadRead = useMarkThreadRead(channelId)

  // 패널을 연 부모(스레드)를 읽음 처리. 부모가 바뀔 때마다 1회.
  // markThreadRead/parent.unreadReplyCount 는 deps 에서 의도적으로 제외(부모 전환 시에만 1회 발화).
   
  useEffect(() => {
    markThreadRead(parent.id, parent.unreadReplyCount)
  }, [parent.id])

  return (
    // 모바일: 채널 컬럼을 숨기고 전체폭(메일·연락처 상세와 같은 "목록 숨김 + 전체폭 상세" 규칙, WP-207).
    // 데스크톱(≥1024px)은 기존 w-96 우측 패널 그대로.
    <div
      className={cn('flex h-full min-h-0 flex-col', isMobile ? 'w-full' : 'w-96 border-l')}
      data-testid="thread-panel"
    >
      {isMobile ? (
        // 모바일 상세 헤더 패턴 재사용(‹ + 제목 + 보조). ‹ 는 onClose(=히스토리 닫기) — 기본 useMobileBack(경로 단위)을 쓰지 않는다.
        <MobileDetailBar
          title="스레드"
          // 긴 채널명이 먼저 말줄임되고 "스레드" 제목은 온전히 남는다(제목 shrink-0, 채널명 min-w-0 truncate).
          titleClassName="shrink-0"
          titleAccessory={
            <span data-testid="thread-channel-name" className="min-w-0 truncate text-xs text-muted-foreground">
              #{channelName}
            </span>
          }
          onBack={onClose}
        />
      ) : (
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
      )}
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
          // 답글 첫 조회 전엔 첨부 뷰어 열림 표식을 지우지 않는다(WP-279).
          ready={data !== undefined}
          channelId={channelId}
          currentUserId={me.id}
          members={members}
          disableMarkRead
          emptyState={
            /* 답글 0건일 때 빈 공백 대신 안내 메시지 표시 */
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-6 w-6" />
              <p>아직 답글이 없어요.</p>
              <p className="text-xs">첫 번째 답글을 남겨보세요.</p>
            </div>
          }
        />
      </div>
      <MessageComposer
        channelId={channelId}
        members={members}
        archived={archived}
        onSend={(body, fileIds, driveFileIds) =>
          reply.mutateAsync({
            body,
            fileIds,
            driveFileIds: driveFileIds.length ? driveFileIds : undefined,
          })
        }
      />
    </div>
  )
}
