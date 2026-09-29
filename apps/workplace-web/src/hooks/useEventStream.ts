// 통합 실시간 SSE 구독 훅 — 단일 /api/v1/events 커넥션 1개로 chat·messaging·notify·issue 이벤트를 받아
// 이름 prefix 로 도메인 핸들러에 fan-out 한다. 과거 useChatStream/useMessageStream/useNotificationStream
// 3개 훅(커넥션 3개)을 대체한다. { isConnected } 는 단일 커넥션 상태(끊김 배너용).
// issue.* prefix(#579) — 이슈 코멘트가 다른 탭/사용자에게 실시간 반영되지 않던 갭을 메운다.

import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { emitAiStreamEvent } from '../lib/aiEventBus';
import { subscribeEventStream } from '../lib/eventStream';
import { isProtectedKey } from '../lib/resourceInvalidation';
import { handleChatEvent } from './useChatStream';
import { handleIssueEvent } from './useIssueStream';
import { handleMessagingEvent } from './useMessageStream';
import { handleNotifyEvent } from './useNotificationStream';
import { handleResourceEvent } from './useResourceStream';
import { handleWikiEvent } from './useWikiStream';

// 이벤트 이름 prefix 로 도메인 핸들러에 분배(순수 라우터). 알 수 없는 prefix 는 무시.
export function routeStreamEvent(
  name: string,
  data: unknown,
  ctx: { qc: QueryClient; currentUserId: number },
) {
  // resource.changed(WP-59) — 서버 모든 C/U/D 의 범용 변경 이벤트를 리소스별 무효화 규칙으로 처리.
  if (name === 'resource.changed') handleResourceEvent(ctx.qc, data);
  else if (name.startsWith('chat.')) handleChatEvent(ctx.qc, name, data);
  else if (name.startsWith('messaging.')) handleMessagingEvent(ctx.qc, name, data, ctx.currentUserId);
  else if (name.startsWith('notify.')) handleNotifyEvent(ctx.qc, name);
  else if (name.startsWith('issue.')) handleIssueEvent(ctx.qc, name, data);
  else if (
    name.startsWith('wiki.ai.') ||
    name.startsWith('drive.overview.') ||
    name.startsWith('home.chat.')
  ) {
    emitAiStreamEvent(name, data);
  }
  // wiki.page.*(노트 생성·수정·삭제·이동, #724) — wiki.ai.* 분기 뒤에 둬야 인에디터 토큰 스트림과 섞이지 않는다.
  else if (name.startsWith('wiki.')) handleWikiEvent(ctx.qc, name, data);
}

/**
 * SSE 재연결 직후 catch-up (WP-59). SseRegistry 는 best-effort 라 끊김 동안의 resource.changed 는 유실된다 —
 * 화면에 떠 있는(active) 쿼리만 재조회해 놓친 변경을 따라잡는다. AI 요약·세션 등 보호 키는 제외(재생성 비용).
 * 알림·채널·DM 도 이 전체 무효화에 포함된다(기존 3개 키 catch-up 을 대체).
 */
export function reconnectCatchUp(qc: QueryClient) {
  void qc.invalidateQueries({
    refetchType: 'active',
    predicate: (q) => !isProtectedKey(q.queryKey),
  });
}

/**
 * SSE onOpen 콜백 팩토리. 첫 연결은 초기 로딩 직후라 건너뛰고, 재연결에서만 catch-up 한다 (WP-59).
 */
export function createCatchUp(qc: QueryClient): () => void {
  let opened = false;
  return () => {
    if (!opened) {
      opened = true;
      return;
    }
    reconnectCatchUp(qc);
  };
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
    const catchUp = createCatchUp(qc);
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
