// 이슈 채팅 드로워 토글 버튼 — 헤더 액션에 위치. 미읽음 배지 포함(구 IssueChatPanel 로직 이관).
// 무엇을: MessageSquare 아이콘 + "채팅" + 미읽음 배지. 드로워가 닫혀 있는 동안 도착한 '타인' 메시지를 카운트, 열면 0 리셋.
// 왜: 채팅을 드로워로 옮기면서도 새 메시지 도착 신호를 헤더에서 유지.
// 미읽음은 메시지 id 로 센다(WP-1372) — 스레드 캐시의 내 읽음 워터마크(useMarkChatRead 가 읽음 성공 때 올린다)보다 큰 것만.
// 그래서 실제로 읽으면(드로워·개인 작업 상세 안 채팅에서 마지막 메시지가 보이면) 배지가 지워지고, 읽은 메시지는 다시 세지 않는다.

import { MessageSquare } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CountBadge } from '@/components/CountBadge';
import { Button } from '@/components/ui/button';
import { useChatThread } from '@/hooks/queries/useChatThread';
import { useAuth } from '@/hooks/useAuth';
import { onChatMessageCreated } from '@/hooks/useChatStream';

export function IssueChatButton({
  projectKey,
  issueNumber,
  open = false,
  onOpen,
  variant = 'default',
}: {
  projectKey: string;
  issueNumber: number;
  /** 드로워가 열려 있는가(팀 이슈·데스크톱 개인 작업) — 열려 있으면 읽는 중으로 보고 0. 채팅이 늘 화면에 있는 모바일 개인 작업 상세는 생략(읽음 워터마크로만 지운다). */
  open?: boolean;
  onOpen: () => void;
  /**
   * 'icon' — 모바일 병합 헤더용 44px 아이콘 버튼(⋯ 메뉴 밖, M5). 미읽음은 숫자 배지 대신 빨간 점.
   * 기본은 데스크톱 헤더의 "채팅" 글자 버튼 + 숫자 배지.
   */
  variant?: 'default' | 'icon';
}) {
  const threadQ = useChatThread(projectKey, issueNumber);
  const { user } = useAuth();
  const threadId = threadQ.data?.threadId ?? 0;
  const currentUserId = user?.id ?? 0;
  // 내 읽음 워터마크 — 스레드 캐시의 내 lastReadMessageId. 읽음 표시가 성공하면 useMarkChatRead 가 올린다.
  const myLastRead = threadQ.data?.members?.find((m) => m.userId === currentUserId)?.lastReadMessageId ?? 0;
  // 로드 시점 '타인'의 미삭제 메시지 id(recentMessages 범위 근사치). 스레드 응답이 없거나 형태가 어긋나면(빈/비정상 페이로드) 빈 목록 —
  // 헤더 버튼이 이슈 상세 진입 시 항상 마운트되므로, 깨진 데이터로 페이지 전체가 죽지 않도록 방어.
  const loadedIds = useMemo(() => {
    const data = threadQ.data;
    if (!data || !Array.isArray(data.recentMessages)) return [];
    return data.recentMessages.filter((m) => m.authorId !== currentUserId && !m.deleted).map((m) => m.id);
  }, [threadQ.data, currentUserId]);
  // 드로워 닫힘 동안 SSE 로 도착한 '타인' 메시지 id — 같은 id 는 한 번만(스트림 재연결로 같은 created 를 다시 받아도).
  const [liveIds, setLiveIds] = useState<number[]>([]);

  // 드로워 닫힘 동안 도착한 '타인' 메시지를 모은다, 열면 비운다(열림 동안 미구독).
  useEffect(() => {
    if (open) {
      setLiveIds([]);
      return;
    }
    if (!threadId) return;
    return onChatMessageCreated((e) => {
      if (e.threadId !== threadId || e.authorId === currentUserId) return;
      setLiveIds((ids) => (ids.includes(e.messageId) ? ids : [...ids, e.messageId]));
    });
  }, [open, threadId, currentUserId]);

  // 열려 있으면(읽는 중) 0, 아니면 내 읽음 워터마크보다 큰 메시지 id 수(로드 시점 + 라이브, 겹치면 한 번).
  const unreadCount = open ? 0 : new Set([...loadedIds, ...liveIds].filter((id) => id > myLastRead)).size;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={unreadCount > 0 ? `채팅 열기, 읽지 않은 메시지 ${unreadCount}개` : '채팅 열기'}
        data-testid="issue-chat-open"
        className="relative flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground"
      >
        <MessageSquare className="h-5 w-5" />
        {unreadCount > 0 && (
          // 좁은 헤더에선 숫자 대신 점 — 개수는 aria-label 이 알린다.
          <span
            data-testid="issue-chat-unread-dot"
            aria-hidden
            className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </button>
    );
  }

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
