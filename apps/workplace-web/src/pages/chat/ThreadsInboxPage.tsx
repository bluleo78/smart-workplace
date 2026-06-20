// #65 2단계: 크로스채널 미읽음 스레드 인박스. 카드 클릭 → 해당 채널 + 스레드 패널(?thread=).
import { Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { useThreadsInbox } from '@/hooks/queries/useThreadsInbox'
import type { ThreadInboxItem } from '@/types/messaging'

export default function ThreadsInboxPage() {
  const navigate = useNavigate()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useThreadsInbox()
  const items: ThreadInboxItem[] = data?.pages.flatMap((p) => p.items) ?? []

  // 카드 클릭 → 채널로 이동 + ?thread= 로 스레드 패널 오픈. rootMessage 를 navigate state 로 넘겨
  // 채널 메시지 캐시에 없어도 패널을 열 수 있게 한다.
  function openThread(item: ThreadInboxItem) {
    const root = item.rootMessage
    navigate(`/chat/channels/${root.channelId}?thread=${root.id}`, {
      state: { threadParent: root },
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="threads-inbox-page">
      <PageHeader title="스레드" icon={<Inbox className="h-5 w-5 text-muted-foreground" />} />
      {!isLoading && items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <ChatEmptyState
            icon={<Inbox className="h-10 w-10" />}
            title="새 스레드 답글이 없어요"
            description="내가 시작했거나 참여한 스레드에 새 답글이 달리면 여기에 모입니다."
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <ul className="mx-auto flex max-w-2xl flex-col gap-2">
            {items.map((item) => (
              <li key={item.rootMessage.id}>
                <button
                  type="button"
                  data-testid={`thread-inbox-card-${item.rootMessage.id}`}
                  onClick={() => openThread(item)}
                  className="flex w-full flex-col gap-1 rounded-md border p-3 text-left hover:bg-accent/50"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">#{item.channelName}</span>
                    <span className="ml-auto rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
                      새 답글 {item.rootMessage.unreadReplyCount}개
                    </span>
                  </div>
                  <div className="truncate text-sm">{item.rootMessage.body}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.rootMessage.authorName}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <div className="flex justify-center p-3">
              <Button
                size="sm"
                variant="ghost"
                data-testid="threads-inbox-more"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage ? '불러오는 중…' : '더 보기'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
