// 이슈 상세 inline chat section.
// thread lazy fetch → messages infinite query (recentMessages seed). 실시간은 SSE(useChatStream).
// 타이핑: 입력 시 typing 송신 + 다른 멤버 typing 표시. mark-read 는 debounce 게이팅.

import { useEffect, useMemo, useRef, useState } from 'react';

import { AiWorkingBubble } from '@/components/chat/AiWorkingBubble';

import { chatApi } from '../../../../api/chat';
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
import { type ChatProgressEvent,onChatProgress, onChatTyping } from '../../../../hooks/useChatStream';
import { useDebounceValue } from '../../../../hooks/useDebounceValue';
import { deleteMessageWithUndo } from '../../../../lib/deleteWithUndo';
import { ChatComposer } from './ChatComposer';
import { ChatMessageEditor } from './ChatMessageEditor';
import { ChatMessageList } from './ChatMessageList';

interface IssueChatSectionProps {
  projectKey: string;
  issueNumber: number;
}

export function IssueChatSection({ projectKey, issueNumber }: IssueChatSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
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
    initialFirstPage,
  });

  const messages = useMemo(
    () => (messagesQ.data?.pages ?? []).flatMap((p) => p.items),
    [messagesQ.data],
  );

  const threadId = threadQ.data?.threadId ?? 0;
  const createMutation = useCreateChatMessage(
    threadId,
    {
      id: me?.id ?? 0,
      name: me?.name ?? me?.username ?? '나',
      kind: 'HUMAN',
    },
    threadQ.data?.members ?? [],
  );
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

  // 다른 멤버의 타이핑 표시 (SSE typing 버스 구독, 4초 TTL). 본인 이벤트는 무시.
  const [typingNames, setTypingNames] = useState<Map<number, { name: string; at: number }>>(
    new Map(),
  );
  useEffect(() => {
    const unsub = onChatTyping((e) => {
      if (e.threadId !== threadId || e.userId === (me?.id ?? 0)) return;
      setTypingNames((prev) => {
        const next = new Map(prev);
        next.set(e.userId, { name: e.name, at: Date.now() });
        return next;
      });
    });
    const ttl = setInterval(() => {
      setTypingNames((prev) => {
        const now = Date.now();
        const next = new Map([...prev].filter(([, v]) => now - v.at < 4000));
        return next.size === prev.size ? prev : next;
      });
    }, 1000);
    return () => {
      unsub();
      clearInterval(ttl);
    };
  }, [threadId, me?.id]);

  // AI 작업 중 유령 버블 상태 관리 — streamId → 이벤트+타임스탬프 Map.
  // phase done/error 이벤트 수신 시 해당 항목 제거, 신규 AGENT 메시지 도착 시 전체 초기화.
  const [working, setWorking] = useState<Map<string, ChatProgressEvent & { at: number }>>(
    new Map(),
  );
  useEffect(() => {
    return onChatProgress((e) => {
      if (e.threadId !== threadId) return;
      setWorking((prev) => {
        const next = new Map(prev);
        if (e.phase === 'done' || e.phase === 'error') next.delete(e.streamId);
        else next.set(e.streamId, { ...e, at: Date.now() });
        return next;
      });
    });
  }, [threadId]);

  // 신규 AGENT 메시지가 도착하면(실제 응답 등장) 모든 유령 버블 제거 — done 이벤트 누락/순서 역전 대비 백스톱.
  // message.id 는 서버 단조 증가 시퀀스이므로 "기준선(초기 로드 시점의 최대 AGENT id) 초과" 만 신규 도착으로 본다.
  // → 스크롤백 페이지네이션(과거 작은 id prepend)·HUMAN 메시지·낙관적 임시 id 는 트리거하지 않는다 (#346).
  const messagesLoaded = messagesQ.data !== undefined;
  const maxAgentMsgId = messages.reduce(
    (mx, m) => (m.authorKind === 'AGENT' && m.id > mx ? m.id : mx),
    0,
  );
  const agentBaselineRef = useRef<number | null>(null);
  useEffect(() => {
    if (!messagesLoaded) return; // 첫 메시지 로드 전 — 기준선 미설정(라이브 버블 보호)
    // 최초 로드: 기존 AGENT 메시지 최대 id 를 기준선으로 잡는다(0 이어도). 이 run 에서는 절대 제거하지 않는다.
    if (agentBaselineRef.current === null) {
      agentBaselineRef.current = maxAgentMsgId;
      return;
    }
    if (maxAgentMsgId > agentBaselineRef.current) {
      agentBaselineRef.current = maxAgentMsgId;
      setWorking(new Map());
    }
  }, [messagesLoaded, maxAgentMsgId]);

  // TTL 안전망: 60초 무수신 유령 제거 (10초마다 스위프)
  useEffect(() => {
    const t = setInterval(() => {
      setWorking((prev) => {
        const cutoff = Date.now() - 60_000;
        const next = new Map([...prev].filter(([, v]) => v.at >= cutoff));
        return next.size === prev.size ? prev : next;
      });
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  // 입력 중 3초 throttle 로 typing 송신.
  const lastTypingRef = useRef(0);
  const handleTyping = () => {
    const now = Date.now();
    if (threadId > 0 && now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      chatApi.sendTyping(threadId).catch(() => {});
    }
  };

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
          <span>채팅을 불러오지 못했습니다.</span>
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
          onDelete={(id) => deleteMessageWithUndo(() => deleteMutation.mutate(id))}
          onMarkRead={(id) => setPendingReadId(id)}
          editingMessageId={editingId}
          renderEditor={(m) => (
            <ChatMessageEditor
              initialBody={m.body}
              initialMentions={m.mentions}
              members={thread.members}
              onSave={(body) => {
                // 성공 시에만 에디터를 닫는다(#123). onSettled 는 실패에도 닫혀 수정 내용이
                // 소실됐다 — useUpdateChatMessage 가 onError 에서 캐시를 보존하는 의도(재시도 가능)와
                // 일치시키기 위해 onSuccess 로 전환. 실패 시 에디터는 입력 내용을 유지한 채 열려 있다.
                updateMutation.mutate(
                  { messageId: m.id, payload: { body } },
                  { onSuccess: () => setEditingId(null) },
                );
              }}
              onCancel={() => setEditingId(null)}
            />
          )}
        />
        {typingNames.size > 0 && (
          <div className="px-4 pb-1 text-xs text-muted-foreground" data-testid="chat-typing">
            {[...typingNames.values()].map((v) => v.name).join(', ')} 입력 중…
          </div>
        )}
        {/* AI 작업 중 유령 버블 — progress 이벤트 발생 시 typing 표시 아래에 렌더 */}
        {working.size > 0 &&
          [...working.values()].map((w) => (
            <ul key={w.streamId} className="px-4">
              <AiWorkingBubble agentName={w.agentName} steps={w.steps} />
            </ul>
          ))}
        <ChatComposer
          members={thread.members}
          onSubmit={(body) => createMutation.mutateAsync({ body })}
          onTyping={handleTyping}
        />
      </CardContent>
    </Card>
  );
}
