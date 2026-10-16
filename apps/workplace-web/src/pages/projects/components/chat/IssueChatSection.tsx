// 이슈 상세 inline chat section.
// thread lazy fetch → messages infinite query (recentMessages seed). 실시간은 SSE(useChatStream).
// 타이핑: 입력 시 typing 송신 + 다른 멤버 typing 표시. mark-read 디바운스는 useMarkChatRead 가 맡는다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AiWorkingBubble } from '@/components/chat/AiWorkingBubble';

import { chatApi } from '../../../../api/chat';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useChatMessages } from '../../../../hooks/queries/useChatMessages';
import { useChatThread } from '../../../../hooks/queries/useChatThread';
import { useCreateChatMessage } from '../../../../hooks/queries/useCreateChatMessage';
import { useDeleteChatMessage } from '../../../../hooks/queries/useDeleteChatMessage';
import { useIssue } from '../../../../hooks/queries/useIssue';
import { useMarkChatRead } from '../../../../hooks/queries/useMarkChatRead';
import { useUpdateChatMessage } from '../../../../hooks/queries/useUpdateChatMessage';
import { useAiWorkingBubbles } from '../../../../hooks/useAiWorkingBubbles';
import { useAuth } from '../../../../hooks/useAuth';
import { onChatTyping, onThreadProgress } from '../../../../hooks/useChatStream';
import { agentQuestionWorks } from '../../../../lib/agentWork';
import { deleteMessageWithUndo } from '../../../../lib/deleteWithUndo';
import { ChatComposer } from './ChatComposer';
import { ChatMessageEditor } from './ChatMessageEditor';
import { ChatMessageList } from './ChatMessageList';
import { agentReplyHint } from './composerHint';
import type { QuestionWorks } from './questionState';

interface IssueChatSectionProps {
  projectKey: string;
  issueNumber: number;
  /** true 면 카드 크롬·헤더 없이 부모(드로워) 높이를 채운다. 메시지 영역 flex-1, 컴포저 하단 고정. */
  embedded?: boolean;
  /**
   * 주어지면 footer(타이핑·AI 작업 버블·입력창)를 이 요소로 포털한다 — 모바일 개인 작업 상세가 입력줄을 화면 하단 in-flow 줄에
   * 붙여 키보드 바로 위에 두기 위해(WP-221). null = 대상이 아직 마운트 전이라 렌더 보류. 미지정 = 기존 위치(카드/드로워 안).
   */
  footerContainer?: HTMLElement | null;
  /** true 면 카드·헤더 크롬 없이 「채팅」 소제목 + 목록만(모바일 개인 작업 상세 — 메모와 같은 급, WP-221 디자인 리뷰 R2). */
  plain?: boolean;
}

/**
 * 이슈 채팅 섹션 — 이슈(projectKey/issueNumber)마다 본문을 새로 마운트한다(WP-418).
 * 부모(이슈 상세 드로워·개인 작업 상세)가 이슈를 바꿔도 같은 자리에 재사용하므로, key 가 없으면 AI 유령 버블·편집 중 메시지·
 * 읽음 디바운스 같은 스레드별 상태가 다음 이슈로 넘어간다. 부모 세 곳에 key 를 기억시키는 대신 여기 한 곳에서 보장한다.
 */
export function IssueChatSection(props: IssueChatSectionProps) {
  return <IssueChatSectionBody key={`${props.projectKey}/${props.issueNumber}`} {...props} />;
}

function IssueChatSectionBody({
  projectKey,
  issueNumber,
  embedded = false,
  footerContainer,
  plain = false,
}: IssueChatSectionProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const auth = useAuth();
  const me = auth.user;

  const threadQ = useChatThread(projectKey, issueNumber);

  // 질문 「답변됨」 판정용 — 이슈의 AI 작업(답변 대기 여부·마지막 갱신 시각). 이슈 상세와 같은 쿼리 키라 캐시를 공유하고,
  // AI 작업 상태가 바뀌면 서버의 issue 변경 알림이 상세를 무효화해 다시 불러온다. 받는 중이면 'loading'(대기 중으로 간주),
  // 마지막 조회가 실패했으면 'failed' — 실패한 리페치 뒤에도 쿼리는 이전 데이터를 들고 있어, 그 사이 답이 달린 질문을 옛 상태로 단정하게 되므로(WP-391).
  const issueQ = useIssue(projectKey, issueNumber);
  // 쿼리의 구조 공유로 내용이 같으면 agentWork 참조가 그대로라, 리페치돼도 질문 상태를 다시 계산하지 않는다.
  const issueFailed = issueQ.isError;
  const hasIssue = issueQ.data !== undefined;
  const agentWork = issueQ.data?.summary.agentWork;
  const questionWorks = useMemo<QuestionWorks>(
    () => (issueFailed ? 'failed' : hasIssue ? agentQuestionWorks(agentWork) : 'loading'),
    [issueFailed, hasIssue, agentWork],
  );

  // 스레드 응답의 최근 메시지를 다음 페이지 정보와 함께 첫 페이지로 시드한다(WP-365).
  const initialFirstPage = useMemo(
    () =>
      threadQ.data
        ? {
            items: threadQ.data.recentMessages,
            nextCursor: threadQ.data.recentNextCursor ?? null,
            hasMore: threadQ.data.recentHasMore ?? false,
          }
        : undefined,
    [threadQ.data],
  );

  const messagesQ = useChatMessages({
    threadId: threadQ.data?.threadId,
    initialFirstPage,
    initialDataUpdatedAt: threadQ.dataUpdatedAt,
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
  // 읽음 표시 — 1초 디바운스·중복 억제·언마운트 시 남은 읽음 flush 는 훅이 맡는다.
  const markRead = useMarkChatRead(threadId);

  const [editingId, setEditingId] = useState<number | null>(null);

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

  // AI 작업 중 유령 버블 — 진행 이벤트·새 AGENT 메시지·TTL·종료 스트림 부활 차단 규칙은 채널/DM 과 같은 useAiWorkingBubbles(WP-418).
  // 키는 스레드 로드 전 undefined(구독 안 함). 이슈가 바뀌면 바깥 IssueChatSection 이 key 로 리마운트해 상태가 비워진다.
  const messagesLoaded = messagesQ.data !== undefined;
  const working = useAiWorkingBubbles(threadQ.data?.threadId, onThreadProgress, messages, messagesLoaded);

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
    if (embedded) {
      return (
        <div
          ref={rootRef as React.Ref<HTMLDivElement>}
          data-testid="chat-section"
          className="flex min-h-0 flex-1 flex-col p-4"
        >
          <Skeleton className="h-32 w-full" />
        </div>
      );
    }
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
    const errorBody = (
      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>채팅을 불러오지 못했습니다.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => threadQ.refetch()}
          data-testid="chat-thread-retry"
        >
          다시 시도
        </Button>
      </div>
    );
    if (embedded) {
      return (
        <div
          ref={rootRef as React.Ref<HTMLDivElement>}
          data-testid="chat-section"
          className="flex min-h-0 flex-1 flex-col p-4"
        >
          {errorBody}
        </div>
      );
    }
    return (
      <Card ref={rootRef as React.Ref<HTMLDivElement>} data-testid="chat-section">
        <CardHeader>
          <CardTitle className="text-base">이슈 채팅</CardTitle>
        </CardHeader>
        <CardContent>{errorBody}</CardContent>
      </Card>
    );
  }

  const thread = threadQ.data;

  // 메시지 목록 — embedded 면 부모 높이를 채움(fill).
  const messageList = (
    <ChatMessageList
      messages={messages}
      currentUserId={me?.id ?? 0}
      hasMore={messagesQ.hasNextPage ?? false}
      isFetchingMore={messagesQ.isFetchingNextPage}
      onLoadMore={() => messagesQ.fetchNextPage()}
      onEdit={(id) => setEditingId(id)}
      onDelete={(id) => deleteMessageWithUndo(() => deleteMutation.mutate(id))}
      onMarkRead={markRead}
      editingMessageId={editingId}
      fill={embedded}
      compact={plain}
      questionWorks={questionWorks}
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
  );
  // 타이핑/AI 작업/컴포저 — 하단 고정 영역.
  const footer = (
    <>
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
      {/* WP-213: 쓸 수 없는 사용자(공개 프로젝트 열람자 등)는 보내기 후 403 대신 입력창 자리에 안내를 본다.
          canPost 가 없는 구 API 응답은 쓸 수 있는 것으로 본다(=== false 일 때만 숨김). */}
      {thread.canPost === false ? (
        <p
          className="border-t p-3 text-sm text-muted-foreground"
          data-testid="chat-composer-readonly"
        >
          이 대화는 프로젝트 멤버와 이슈를 등록한 사람만 쓸 수 있습니다.
        </p>
      ) : (
        <ChatComposer
          threadId={threadId}
          members={thread.members}
          onSubmit={(body, fileIds, driveFileIds) =>
            createMutation.mutateAsync({ body, fileIds, driveFileIds })
          }
          onTyping={handleTyping}
          // 드로워(embedded)로 열면 바로 입력할 수 있게 컴포저에 포커스. 터치 기기는 가상 키보드가
          // 드로워 절반을 덮으므로 정밀 포인터(마우스·트랙패드)일 때만 한다.
          autoFocus={embedded && window.matchMedia('(pointer: fine)').matches}
          // 외부 실행 AI 가 담당한 이슈면 멘션 없이 답해도 그 AI 가 이어받는다는 안내(WP-373).
          placeholder={agentReplyHint(thread.externalAgent?.name)}
        />
      )}
    </>
  );
  // 포털 대상이 있으면 그리로, null(대상 마운트 전)이면 보류, 미지정이면 제자리(데스크톱·드로워 DOM 불변).
  const footerNode =
    footerContainer === undefined ? footer : footerContainer ? createPortal(footer, footerContainer) : null;

  // embedded — 카드/헤더 없이 부모 높이 채움. 메시지 영역 flex-1 스크롤, footer 하단 고정.
  if (embedded) {
    return (
      <div
        ref={rootRef as React.Ref<HTMLDivElement>}
        data-testid="chat-section"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="min-h-0 flex-1">{messageList}</div>
        {footerNode}
      </div>
    );
  }

  if (plain) {
    return (
      <section ref={rootRef as React.Ref<HTMLElement>} data-testid="chat-section" aria-label="채팅" className="space-y-1">
        <h2 className="text-xs font-medium text-muted-foreground">채팅</h2>
        {messageList}
        {footerNode}
      </section>
    );
  }

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
        {messageList}
        {footerNode}
      </CardContent>
    </Card>
  );
}
