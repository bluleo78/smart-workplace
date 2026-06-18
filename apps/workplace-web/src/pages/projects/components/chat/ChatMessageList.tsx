// chat 메시지 스크롤 리스트.
// 최신이 아래(Slack 스타일). 위로 스크롤 시 fetchNextPage.
// 마지막 메시지가 viewport 진입하면 onMarkRead(lastId) 호출 — debounce 는 부모에서 처리.

import { Fragment, useEffect, useMemo, useRef } from 'react';

import { DateDivider } from '../../../../components/chat/DateDivider';
import { Button } from '../../../../components/ui/button';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import { getDateKey } from '../../../../lib/formatters';
import type { ChatMessageResponse } from '../../../../types/chat';
import { ChatMessageRow } from './ChatMessageRow';

interface ChatMessageListProps {
  messages: ChatMessageResponse[];
  currentUserId: number;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onMarkRead: (lastMessageId: number) => void;
  editingMessageId: number | null;
  renderEditor: (message: ChatMessageResponse) => React.ReactNode;
}

export function ChatMessageList({
  messages,
  currentUserId,
  hasMore,
  isFetchingMore,
  onLoadMore,
  onEdit,
  onDelete,
  onMarkRead,
  editingMessageId,
  renderEditor,
}: ChatMessageListProps) {
  const lastRef = useRef<HTMLLIElement | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  // 메시지가 createdAt 기준 오름차순이 되도록 한 번 정렬.
  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );
  const lastId = sorted.length > 0 ? sorted[sorted.length - 1].id : null;

  // 최신 메시지(lastId)가 바뀌면 ScrollArea 뷰포트를 바닥으로 스크롤.
  // 초기 로드/새 메시지에는 lastId 가 변하므로 스크롤, '이전 메시지 더 보기'(앞쪽 prepend)는
  // lastId 가 그대로라 스크롤하지 않는다.
  useEffect(() => {
    if (lastId === null) return;
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      '[data-radix-scroll-area-viewport]',
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [lastId]);

  // 마지막 메시지 IO — viewport 진입 시 mark-read.
  useEffect(() => {
    const el = lastRef.current;
    if (!el || lastId === null || lastId < 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onMarkRead(lastId);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lastId, onMarkRead]);

  if (sorted.length === 0) {
    return (
      <div
        className="flex h-32 items-center justify-center text-sm text-muted-foreground"
        data-testid="chat-empty"
      >
        아직 대화가 없어요. 첫 메시지를 남겨보세요.
      </div>
    );
  }

  return (
    <ScrollArea
      ref={scrollRootRef}
      className="h-[min(60vh,480px)] pr-2"
      data-testid="chat-message-list"
    >
      <div className="flex flex-col">
        {hasMore && (
          <div className="flex justify-center py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={onLoadMore}
              disabled={isFetchingMore}
              data-testid="chat-load-more"
            >
              {isFetchingMore ? '불러오는 중...' : '이전 메시지 더 보기'}
            </Button>
          </div>
        )}
        <ul>
          {sorted.map((m, idx) => {
            const isLast = idx === sorted.length - 1;
            const isEditing = editingMessageId === m.id;
            const isPending = m.id < 0;
            const canEdit = m.authorId === currentUserId;

            // 날짜가 바뀌는 지점(또는 첫 메시지) 앞에 날짜 구분선 삽입.
            const prev = idx > 0 ? sorted[idx - 1] : null;
            const showDateDivider = !prev || getDateKey(m.createdAt) !== getDateKey(prev.createdAt);

            if (isEditing) {
              return (
                <Fragment key={m.id}>
                  {showDateDivider && <DateDivider date={m.createdAt} />}
                  <li
                    ref={isLast ? lastRef : undefined}
                    data-testid={`chat-message-${m.id}`}
                  >
                    {renderEditor(m)}
                  </li>
                </Fragment>
              );
            }
            return (
              <Fragment key={m.id}>
                {showDateDivider && <DateDivider date={m.createdAt} />}
                <div ref={isLast ? (lastRef as unknown as React.Ref<HTMLDivElement>) : undefined}>
                  <ChatMessageRow
                    message={m}
                    canEdit={canEdit}
                    isPending={isPending}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </div>
              </Fragment>
            );
          })}
        </ul>
      </div>
    </ScrollArea>
  );
}
