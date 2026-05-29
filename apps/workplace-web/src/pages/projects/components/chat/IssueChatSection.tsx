// 이슈 상세 inline chat section.
// thread lazy fetch → messages infinite query (recentMessages seed) → polling/mark-read 게이팅.

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useChatMessages } from '../../../../hooks/queries/useChatMessages';
import { useChatThread } from '../../../../hooks/queries/useChatThread';
import { useCreateChatMessage } from '../../../../hooks/queries/useCreateChatMessage';
import { useDeleteChatMessage } from '../../../../hooks/queries/useDeleteChatMessage';
import { useMarkChatRead } from '../../../../hooks/queries/useMarkChatRead';
import { useUpdateChatMessage } from '../../../../hooks/queries/useUpdateChatMessage';
import { useAuth } from '../../../../hooks/useAuth';
import { useDebounceValue } from '../../../../hooks/useDebounceValue';
import { ChatComposer } from './ChatComposer';
import { ChatMessageEditor } from './ChatMessageEditor';
import { ChatMessageList } from './ChatMessageList';

interface IssueChatSectionProps {
  projectKey: string;
  issueNumber: number;
}

// document.visibilityState 변화를 React state 로 노출.
function useIsPageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true,
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

// section root 가 viewport 안에 있는지 IntersectionObserver 로 추적.
function useInViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

export function IssueChatSection({ projectKey, issueNumber }: IssueChatSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isPageVisible = useIsPageVisible();
  const isInView = useInViewport(rootRef);
  const auth = useAuth();
  const me = auth.user;

  const threadQ = useChatThread(projectKey, issueNumber);

  const initialFirstPage = useMemo(
    () =>
      threadQ.data
        ? { items: threadQ.data.recentMessages, nextCursor: null, hasMore: false }
        : undefined,
    [threadQ.data],
  );

  const messagesQ = useChatMessages({
    threadId: threadQ.data?.threadId,
    pollingEnabled: !!threadQ.data && isPageVisible && isInView,
    initialFirstPage,
  });

  const messages = useMemo(
    () => (messagesQ.data?.pages ?? []).flatMap((p) => p.items),
    [messagesQ.data],
  );

  const threadId = threadQ.data?.threadId ?? 0;
  const createMutation = useCreateChatMessage(threadId, {
    id: me?.id ?? 0,
    name: me?.name ?? me?.username ?? '나',
    kind: 'HUMAN',
  });
  const updateMutation = useUpdateChatMessage(threadId);
  const deleteMutation = useDeleteChatMessage(threadId);
  const markReadMutation = useMarkChatRead(threadId);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingReadId, setPendingReadId] = useState<number | null>(null);
  const debouncedReadId = useDebounceValue(pendingReadId, 1000);

  useEffect(() => {
    if (debouncedReadId !== null && threadId > 0) {
      markReadMutation.mutate({ uptoMessageId: debouncedReadId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedReadId, threadId]);

  if (threadQ.isLoading) {
    return (
      <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
        <CardHeader>
          <CardTitle className="text-base">이슈 채팅</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (threadQ.isError || !threadQ.data) {
    return (
      <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
        <CardHeader>
          <CardTitle className="text-base">이슈 채팅</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>채팅을 불러오지 못했어요.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => threadQ.refetch()}
            data-testid="chat-thread-retry"
          >
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  const thread = threadQ.data;

  return (
    <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          이슈 채팅
          <span className="text-xs text-muted-foreground">
            멤버 {thread.members.length}명
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ChatMessageList
          messages={messages}
          currentUserId={me?.id ?? 0}
          hasMore={messagesQ.hasNextPage ?? false}
          isFetchingMore={messagesQ.isFetchingNextPage}
          onLoadMore={() => messagesQ.fetchNextPage()}
          onEdit={(id) => setEditingId(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
          onMarkRead={(id) => setPendingReadId(id)}
          editingMessageId={editingId}
          renderEditor={(m) => (
            <ChatMessageEditor
              initialBody={m.body}
              onSave={(body) => {
                updateMutation.mutate(
                  { messageId: m.id, payload: { body } },
                  { onSettled: () => setEditingId(null) },
                );
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
        />
        <ChatComposer
          members={thread.members}
          disabled={createMutation.isPending}
          onSubmit={(body) => createMutation.mutate({ body })}
        />
      </CardContent>
    </Card>
  );
}
