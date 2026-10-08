// #65 2단계: 크로스채널 미읽음 스레드 인박스. 카드 클릭 → 해당 채널 + 스레드 패널(?thread=).
import { Inbox } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { Page } from '@/components/layout/Page'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useThreadsInbox } from '@/hooks/queries/useThreadsInbox'
import { buildThreadsInboxContext } from '@/lib/aiScreenContext/builders/messaging'
import type { ThreadInboxItem } from '@/types/messaging'

export default function ThreadsInboxPage() {
  const navigate = useNavigate()
  const threadsQuery = useThreadsInbox()
  const { data, hasNextPage, isLoading, isLoadingError } = threadsQuery
  // 목록 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const items: ThreadInboxItem[] = data?.pages.flatMap((p) => p.items) ?? []

  // WP-54: 스레드 모아보기 화면 컨텍스트 — 로드된 스레드 수. 로딩/오류 중엔 미등록(미로드 수치 전송 금지).
  const screenContext = useMemo(
    () =>
      data && !isLoadingError
        ? buildThreadsInboxContext({ count: data.pages.flatMap((p) => p.items).length, hasMore: !!hasNextPage })
        : null,
    [data, isLoadingError, hasNextPage],
  )
  useRegisterAiScreenContext(screenContext)

  // 카드 클릭 → 채널로 이동 + ?thread= 로 스레드 패널 오픈. rootMessage 를 navigate state 로 넘겨
  // 채널 메시지 캐시에 없어도 패널을 열 수 있게 한다.
  function openThread(item: ThreadInboxItem) {
    const root = item.rootMessage
    navigate(`/chat/channels/${root.channelId}?thread=${root.id}`, {
      state: { threadParent: root },
    })
  }

  return (
    // 읽기 폭(reading) 페이지 — 카드 목록이 헤더 시작선에서 왼쪽 정렬로 768px 까지만 펼쳐진다.
    <Page width="reading" data-testid="threads-inbox-page">
      <Page.Header title="스레드" icon={<Inbox className="h-5 w-5 text-muted-foreground" />} />
      {!isLoading && items.length === 0 ? (
        <Page.Body padded={false} className="items-center justify-center">
          <ChatEmptyState
            icon={<Inbox className="h-10 w-10" />}
            title="새 스레드 답글이 없어요"
            description="내가 시작했거나 참여한 스레드에 새 답글이 달리면 여기에 모입니다."
          />
        </Page.Body>
      ) : (
        // 본문 스크롤 요소를 무한 스크롤 sentinel 의 root 로 넘긴다(WP-182).
        <Page.Body scrollRef={setScrollEl}>
          <ul className="flex flex-col gap-2">
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
          {/* WP-182: 끝에 닿으면 자동 로드 — 실패했을 때만 다시 시도 버튼 */}
          <LoadMoreFooter query={threadsQuery} root={scrollEl} data-testid="threads-inbox-more" />
        </Page.Body>
      )}
    </Page>
  )
}
