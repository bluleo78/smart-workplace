// #65 2단계: 크로스채널 미읽음 스레드 인박스. 카드 클릭 → 해당 채널(DM 은 DM 화면) + 스레드 패널(?thread=).
import { Inbox } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ChatEmptyState } from '@/components/chat/ChatEmptyState'
import { Page } from '@/components/layout/Page'
import { messagePlainText } from '@/components/mentions/parseMessageSegments'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useMyDms } from '@/hooks/queries/useMyDms'
import { useThreadsInbox } from '@/hooks/queries/useThreadsInbox'
import { useAuth } from '@/hooks/useAuth'
import { buildThreadsInboxContext } from '@/lib/aiScreenContext/builders/messaging'
import { dmDisplayName } from '@/lib/dm'
import type { ThreadInboxItem } from '@/types/messaging'

export default function ThreadsInboxPage() {
  const navigate = useNavigate()
  const threadsQuery = useThreadsInbox()
  const { data, hasNextPage, isLoading, isLoadingError } = threadsQuery
  // 목록 스크롤 요소 — 무한 스크롤 sentinel 의 root(WP-182). 콜백 ref 라 마운트 후 재부착된다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const items: ThreadInboxItem[] = data?.pages.flatMap((p) => p.items) ?? []
  // DM 카드 표기 — DM 은 이름이 없어(null) 사이드바와 같은 상대 이름을 쓴다. 목록을 아직 못 받았으면 「메시지」로 둔다(WP-1083).
  const { user } = useAuth()
  const { data: dms } = useMyDms()
  const cardLabel = (item: ThreadInboxItem): string => {
    if (item.channelKind !== 'DM') return `#${item.channelName ?? '채널'}`
    const dm = dms?.find((d) => d.id === item.rootMessage.channelId)
    return dm && user ? dmDisplayName(dm, user.id) : '메시지'
  }

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
  // 채널 메시지 캐시에 없어도 패널을 열 수 있게 한다. DM 스레드는 DM 화면으로 — 채널 화면은 DM 을 다루지 않는다(WP-1083).
  function openThread(item: ThreadInboxItem) {
    const root = item.rootMessage
    const base = item.channelKind === 'DM' ? '/chat/dms' : '/chat/channels'
    navigate(`${base}/${root.channelId}?thread=${root.id}`, {
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
                    <span className="font-medium" data-testid={`thread-inbox-card-label-${item.rootMessage.id}`}>
                      {cardLabel(item)}
                    </span>
                    <span className="ml-auto rounded-full bg-destructive px-1.5 text-xs font-semibold text-destructive-foreground">
                      새 답글 {item.rootMessage.unreadReplyCount}개
                    </span>
                  </div>
                  {/* 서식 기호(WP-101)를 빼고 멘션은 이름으로 — 한 줄 미리보기. */}
                  <div className="truncate text-sm">{messagePlainText(item.rootMessage.body, item.rootMessage.mentions)}</div>
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
