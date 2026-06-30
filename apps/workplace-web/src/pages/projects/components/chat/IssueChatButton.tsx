// 이슈 채팅 드로워 토글 버튼 — 헤더 액션에 위치. 미읽음 배지 포함(구 IssueChatPanel 로직 이관).
// 무엇을: MessageSquare 아이콘 + "채팅" + 미읽음 배지. 드로워가 닫혀 있는 동안 도착한 '타인' 메시지를 카운트, 열면 0 리셋.
// 왜: 채팅을 드로워로 옮기면서도 새 메시지 도착 신호를 헤더에서 유지.

import { MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CountBadge } from '@/components/CountBadge';
import { Button } from '@/components/ui/button';
import { useChatThread } from '@/hooks/queries/useChatThread';
import { useAuth } from '@/hooks/useAuth';
import { onChatMessageCreated } from '@/hooks/useChatStream';

export function IssueChatButton({
  projectKey,
  issueNumber,
  open,
  onOpen,
}: {
  projectKey: string;
  issueNumber: number;
  open: boolean;
  onOpen: () => void;
}) {
  const threadQ = useChatThread(projectKey, issueNumber);
  const { user } = useAuth();
  const threadId = threadQ.data?.threadId ?? 0;
  const currentUserId = user?.id ?? 0;
  // 로드 시점 미읽음(스냅샷) — 내 읽음 워터마크(lastReadMessageId)보다 큰 '타인'의 미삭제 메시지 수.
  // recentMessages 범위 내 근사치(라이브 델타는 아래에서 합산). 열려 있으면 읽음 처리되므로 0.
  const baseUnread = useMemo(() => {
    const data = threadQ.data;
    if (!data) return 0;
    const myLastRead =
      data.members.find((m) => m.userId === currentUserId)?.lastReadMessageId ?? 0;
    return data.recentMessages.filter(
      (m) => m.id > myLastRead && m.authorId !== currentUserId && !m.deleted,
    ).length;
  }, [threadQ.data, currentUserId]);
  // 드로워 닫힘 동안 SSE 로 도착한 '타인' 메시지 델타.
  const [liveUnread, setLiveUnread] = useState(0);
  // 이미 카운트한 메시지 id — 스트림 재연결로 동일 created 재수신 시 중복 카운트 방지.
  const seenRef = useRef<Set<number>>(new Set());

  // 드로워 닫힘 동안 도착한 '타인' 메시지를 미읽음으로 카운트, 열면 0 리셋(열림 동안 미구독).
  useEffect(() => {
    if (open) {
      setLiveUnread(0);
      seenRef.current.clear();
      return;
    }
    if (!threadId) return;
    return onChatMessageCreated((e) => {
      if (e.threadId !== threadId || e.authorId === currentUserId) return;
      if (seenRef.current.has(e.messageId)) return;
      seenRef.current.add(e.messageId);
      setLiveUnread((c) => c + 1);
    });
  }, [open, threadId, currentUserId]);

  // 열려 있으면(읽는 중) 0, 아니면 스냅샷 + 라이브 델타.
  const unreadCount = open ? 0 : baseUnread + liveUnread;

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onOpen}
      aria-label="채팅 열기"
      data-testid="issue-chat-open"
      className="relative"
    >
      <MessageSquare className="mr-1 h-4 w-4" />
      채팅
      <CountBadge count={unreadCount} data-testid="issue-chat-unread-badge" className="ml-1" />
    </Button>
  );
}
