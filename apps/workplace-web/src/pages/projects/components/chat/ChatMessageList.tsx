// chat 메시지 스크롤 리스트.
// 최신이 아래(Slack 스타일). 위로 스크롤 시 fetchNextPage.
// 마지막 메시지가 viewport 진입하면 onMarkRead(lastId) 호출 — debounce 는 부모에서 처리.

import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';

import { ChatAttachmentViewerHost } from '@/components/chat/ChatAttachmentViewer';
import { MessageActionSheet } from '@/components/chat/MessageActionSheet';
import {
  buildMessageSheetActions,
  hasMessageSheetActions,
  messagePreview,
  type MessageSheetHandlers,
} from '@/components/chat/messageSheetActions';
import { findChatBundle, issueChatBundle } from '@/components/viewer/viewerItems';
import { useIsTouchShell } from '@/hooks/useIsTouchShell';
import { useMessageListLongPress } from '@/hooks/useMessageListLongPress';
import { useMessageSheet } from '@/hooks/useMessageSheet';

import { DateDivider } from '../../../../components/chat/DateDivider';
import { Button } from '../../../../components/ui/button';
import { ScrollArea } from '../../../../components/ui/scroll-area';
import { getDateKey } from '../../../../lib/formatters';
import type { ChatMessageResponse } from '../../../../types/chat';
import { ChatMessageRow } from './ChatMessageRow';

/** 이슈 채팅 첨부 뷰어 열림 router state 키(WP-279) — 팀 채팅·메인 AI 채팅 키와 나눈다(이슈 상세의 ?preview 첨부 뷰어와도 별개). */
const ISSUE_CHAT_PREVIEW_KEY = 'issueChatPreview';

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
  /** true 면 고정 높이 대신 부모 높이를 채운다(드로워 등 flex 컨테이너 내부). */
  fill?: boolean;
  /** true 면 빈 상태를 낮게(py-6) — 카드 없는 모바일 개인 작업 채팅 섹션용(WP-221). */
  compact?: boolean;
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
  fill = false,
  compact = false,
}: ChatMessageListProps) {
  const lastRef = useRef<HTMLLIElement | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  // 모바일 터치 셸: hover 툴바 대신 길게 누르기 → 작업 시트(목록에 하나).
  const touchShell = useIsTouchShell();

  // 메시지가 createdAt 기준 오름차순이 되도록 한 번 정렬.
  const sorted = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );
  const lastId = sorted.length > 0 ? sorted[sorted.length - 1].id : null;
  const sheet = useMessageSheet(sorted);
  // 시트 작업 — 권한·순서는 messageSheetActions 가 정한다(본인·미삭제·확정 메시지만 수정·삭제 + 복사). 이슈 채팅엔 반응·스레드가 없다.
  const sheetHandlers: MessageSheetHandlers<ChatMessageResponse> = {
    currentUserId,
    onEdit: (m) => onEdit(m.id),
    onDelete: (m) => onDelete(m.id),
  };
  // 반응 줄이 없으므로 작업 행이 하나라도 있어야 연다. 수정 중인 행은 에디터로 바뀌어 대상 표식이 없지만 한 번 더 막는다.
  const sheetOpenable = (m: ChatMessageResponse) =>
    m.id >= 0 && m.id !== editingMessageId && hasMessageSheetActions(m, sheetHandlers);
  const longPress = useMessageListLongPress(
    touchShell,
    (id) => sorted.some((m) => m.id === id && sheetOpenable(m)),
    sheet.show,
  );

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

  const target = sheet.target;
  // WP-279: 열린 첨부 키(cmsg:{메시지}:…) → 이 목록에 그린 그 메시지의 묶음(앞으로가기·드라이브에서 돌아오기 뒤에도 다시 연다).
  const resolveAttachment = useCallback(
    (key: string) => findChatBundle(key, 'cmsg', messages, (m) => issueChatBundle(m.threadId, m)),
    [messages],
  );

  if (sorted.length === 0) {
    return (
      <div
        className={`flex items-center justify-center text-sm text-muted-foreground ${
          fill ? 'h-full min-h-32' : compact ? 'py-6' : 'h-32'
        }`}
        data-testid="chat-empty"
      >
        아직 대화가 없어요. 첫 메시지를 남겨보세요.
      </div>
    );
  }

  return (
    // WP-279: 첨부 썸네일·카드 → 통합 뷰어. 뷰어는 ScrollArea 의 형제로 그려 길게 누르기 위임 핸들러로 이벤트가 새지 않게 한다.
    <ChatAttachmentViewerHost historyKey={ISSUE_CHAT_PREVIEW_KEY} resolve={resolveAttachment}>
      <ScrollArea
        ref={scrollRootRef}
        className={`pr-2 ${fill ? 'h-full' : 'h-[min(60vh,480px)]'}`}
        data-testid="chat-message-list"
      >
        {/* 터치 셸이면 길게 누르기를 이 컨테이너가 위임으로 받는다(행은 data-message-id). 아니면 핸들러 없음. */}
        <div className="flex flex-col" {...longPress}>
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
                      // canEdit 은 "작성자 본인" 과 같은 조건 — 정렬(우측 말풍선)에도 같은 값을 쓴다.
                      isOwn={canEdit}
                      canEdit={canEdit}
                      isPending={isPending}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      // 스크린리더용 "메시지 작업" 버튼(A1) — 길게 누르기와 같은 조건일 때만.
                      onOpenActions={touchShell && sheetOpenable(m) ? () => sheet.show(m.id) : undefined}
                    />
                  </div>
                </Fragment>
              );
            })}
          </ul>
        </div>
        {touchShell && (
          <MessageActionSheet
            open={sheet.open}
            onClose={sheet.close}
            actions={target ? buildMessageSheetActions(target, sheetHandlers) : []}
            preview={target ? messagePreview(target.authorName, target.body, target.mentions) : undefined}
          />
        )}
      </ScrollArea>
    </ChatAttachmentViewerHost>
  );
}
