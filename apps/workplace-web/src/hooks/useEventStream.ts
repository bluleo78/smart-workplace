// 통합 실시간 SSE 구독 훅 — 단일 /api/v1/events 커넥션 1개로 chat·messaging·notify·issue 이벤트를 받아
// 이름 prefix 로 도메인 핸들러에 fan-out 한다. 과거 useChatStream/useMessageStream/useNotificationStream
// 3개 훅(커넥션 3개)을 대체한다. { isConnected } 는 단일 커넥션 상태(끊김 배너용).
// issue.* prefix(#579) — 이슈 코멘트가 다른 탭/사용자에게 실시간 반영되지 않던 갭을 메운다.

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { subscribeEventStream } from '../lib/eventStream';
import { messagingKeys } from './queries/messagingKeys';
import { notificationKeys } from './queries/notificationKeys';
import { handleChatEvent } from './useChatStream';
import { handleIssueEvent } from './useIssueStream';
import { handleMessagingEvent } from './useMessageStream';
import { handleNotifyEvent } from './useNotificationStream';

// 이벤트 이름 prefix 로 도메인 핸들러에 분배(순수 라우터). 알 수 없는 prefix 는 무시.
export function routeStreamEvent(
  name: string,
  data: unknown,
  ctx: { qc: QueryClient; currentUserId: number },
) {
  if (name.startsWith('chat.')) handleChatEvent(ctx.qc, name, data);
  else if (name.startsWith('messaging.')) handleMessagingEvent(ctx.qc, name, data, ctx.currentUserId);
  else if (name.startsWith('notify.')) handleNotifyEvent(ctx.qc, name);
  else if (name.startsWith('issue.')) handleIssueEvent(ctx.qc, name, data);
}

export function useEventStream(currentUserId: number): { isConnected: boolean } {
  const qc = useQueryClient();
  // 재연결(스트림 재구독) 없이 최신 userId 를 참조하기 위해 ref 로 보관.
  const currentUserIdRef = useRef(currentUserId);
  const [isConnected, setIsConnected] = useState(false);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  });

  useEffect(() => {
    // 재연결 직후 catch-up — 끊김 동안 놓친 알림·사이드바 미읽음을 따라잡는다(과거 notify/messaging 동작 보존).
    const catchUp = () => {
      qc.invalidateQueries({ queryKey: notificationKeys.all });
      qc.invalidateQueries({ queryKey: messagingKeys.channels() });
      qc.invalidateQueries({ queryKey: messagingKeys.dms() });
    };
    const cleanup = subscribeEventStream({
      url: '/api/v1/events',
      onEvent: (name, data) =>
        routeStreamEvent(name, data, { qc, currentUserId: currentUserIdRef.current }),
      onOpen: catchUp,
      onConnectedChange: setIsConnected,
    });
    return cleanup;
  }, [qc]);

  return { isConnected };
}
