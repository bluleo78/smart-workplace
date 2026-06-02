// messaging 글로벌 SSE 구독 훅 — 유저당 스트림 1개로 본인이 멤버인 모든 채널 이벤트 수신.
// fetch + ReadableStream 으로 Authorization 헤더 전송(native EventSource 헤더 미지원).
// messaging.message.created 는 react-query messages 캐시를 channelId 로 직접 갱신.
// Phase 5: 스레드 답글 라우팅(parentMessageId) + 리액션 이벤트 패치.

import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getAccessToken, refreshAccessToken } from '../api/client';
import { applyReaction } from '../lib/reactions';
import type { MessagePage, MessageResponse } from '../types/messaging';
import { messagingKeys } from './queries/messagingKeys';
import { bumpReplyCount } from './queries/useCreateReply';
import { patchReactionEverywhere } from './queries/useToggleReaction';

// messages 캐시 첫 페이지에 메시지 prepend (없으면 무시 — 미오픈 채널). id 중복 시 교체.
function upsertMessage(qc: QueryClient, channelId: number, msg: MessageResponse) {
  const key = messagingKeys.messages(channelId);
  qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
    if (!old) return old; // 미오픈 채널 → 열 때 refetch 로 정합
    const exists = old.pages.some((p) => p.items.some((m) => m.id === msg.id));
    if (exists) {
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === msg.id ? msg : m)),
        })),
      };
    }
    const [first, ...rest] = old.pages;
    return { ...old, pages: [{ ...first, items: [msg, ...first.items] }, ...rest] };
  });
}

// 캐시 내 기존 메시지를 부분 patch(merge). updated/deleted 이벤트는 부분 payload 이므로
// full replace 가 아닌 merge 로 적용한다(authorId/authorName 등 보존). 미존재 시 no-op
// (미오픈 채널 → 열 때 refetch 로 정합. created 와 달리 prepend 하지 않음).
function patchMessage(
  qc: QueryClient,
  channelId: number,
  id: number,
  patch: Partial<MessageResponse>,
) {
  const key = messagingKeys.messages(channelId);
  qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        items: p.items.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    };
  });
}

// 사이드바 unread 배지는 서버 재계산이 진실원 — created/read 이벤트에 채널·DM 목록 키를
// invalidate 하면 REST 가 최신 unreadCount 를 다시 가져온다(낙관적 ±1 금지, 스펙 결정).
function invalidateLists(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: messagingKeys.channels() });
  qc.invalidateQueries({ queryKey: messagingKeys.dms() });
}

// 스레드 답글을 thread 캐시 끝(ASC)에 append. 미오픈 스레드면 no-op(열 때 refetch).
function upsertReply(qc: QueryClient, msg: MessageResponse) {
  if (msg.parentMessageId == null) return;
  const key = messagingKeys.thread(msg.parentMessageId);
  qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
    if (!old) return old;
    const exists = old.pages.some((p) => p.items.some((m) => m.id === msg.id));
    if (exists) {
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === msg.id ? msg : m)),
        })),
      };
    }
    const last = old.pages[old.pages.length - 1];
    const head = old.pages.slice(0, -1);
    return { ...old, pages: [...head, { ...last, items: [...last.items, msg] }] };
  });
}

function handleEvent(qc: QueryClient, eventName: string, data: unknown, currentUserId: number) {
  const d = data as Record<string, unknown>;
  // read 이벤트: payload {channelId,userId,lastReadMessageId}. 본인 읽음일 때만 배지 재계산.
  if (eventName === 'messaging.message.read') {
    if (Number(d.userId) === currentUserId) invalidateLists(qc);
    return;
  }
  const channelId = Number(d.channelId);
  if (!channelId) return;
  if (eventName === 'messaging.message.created') {
    const msg = data as MessageResponse;
    if (msg.parentMessageId != null) {
      // 스레드 답글 → 스레드 캐시 upsert(id 멱등) + 부모 replyCount +1. 메인 목록엔 넣지 않음.
      // self-echo 가드 없음: 작성자 본인 echo 도 bump 해야 한다(onMutate 가 낙관적 bump 를 안 하므로).
      // 모든 클라이언트가 동일하게 +1 → 멀티기기 정합. upsertReply 는 id 멱등이라 중복 없음.
      upsertReply(qc, msg);
      bumpReplyCount(qc, channelId, msg.parentMessageId, +1);
    } else {
      upsertMessage(qc, channelId, msg);
    }
    // 미오픈 채널 포함 사이드바 배지 갱신.
    invalidateLists(qc);
    return;
  } else if (eventName === 'messaging.message.updated') {
    // payload: {channelId,id,body,mentions,editedAt}
    const id = Number(d.id);
    if (!id) return;
    patchMessage(qc, channelId, id, {
      body: d.body as string,
      mentions: d.mentions as MessageResponse['mentions'],
      editedAt: d.editedAt as string | null,
    });
  } else if (eventName === 'messaging.message.deleted') {
    // payload: {channelId,id}
    const id = Number(d.id);
    if (!id) return;
    patchMessage(qc, channelId, id, { deleted: true, body: '(삭제됨)' });
  } else if (
    eventName === 'messaging.reaction.added' ||
    eventName === 'messaging.reaction.removed'
  ) {
    // payload: {channelId, messageId, emoji, userId}
    // 내 액션은 낙관적 반영이 진실원(중복 방지). 자기 echo 는 skip.
    if (Number(d.userId) === currentUserId) return;
    const messageId = Number(d.messageId);
    if (!messageId) return;
    const delta: 1 | -1 = eventName === 'messaging.reaction.added' ? 1 : -1;
    const isMe = false; // self-echo 가드로 이미 걸러졌으므로 항상 false
    patchReactionEverywhere(qc, channelId, messageId, (rs) =>
      applyReaction(rs, String(d.emoji), delta, isMe),
    );
  }
}

export function useMessageStream(currentUserId: number) {
  const qc = useQueryClient();
  // read 이벤트 필터(본인 읽음만 invalidate)용 — ref 로 보관해 재연결(스트림 재구독) 없이 최신값 참조.
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(1000 * Math.pow(2, attempt), 60_000) + Math.random() * 1000;
      attempt++;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      const token = getAccessToken();
      if (!token) {
        scheduleReconnect();
        return;
      }
      controller = new AbortController();
      try {
        const response = await fetch('/api/v1/messaging/stream', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'include',
        });
        if (response.status === 401) {
          const refreshed = await refreshAccessToken();
          if (!refreshed) {
            cancelled = true;
            return;
          }
          scheduleReconnect();
          return;
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        attempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = 'message';
        let currentData = '';

        const dispatch = () => {
          if (currentData) {
            try {
              handleEvent(qc, currentEvent, JSON.parse(currentData), currentUserIdRef.current);
            } catch {
              // 잘못된 SSE 데이터 무시
            }
          }
          currentEvent = 'message';
          currentData = '';
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, '');
            buffer = buffer.slice(nl + 1);
            if (line === '') {
              dispatch();
              continue;
            }
            if (line.startsWith(':')) continue; // heartbeat/comment
            const ci = line.indexOf(':');
            const field = ci === -1 ? line : line.slice(0, ci);
            const raw = ci === -1 ? '' : line.slice(ci + 1);
            const val = raw.startsWith(' ') ? raw.slice(1) : raw;
            if (field === 'event') currentEvent = val;
            else if (field === 'data') currentData = currentData ? `${currentData}\n${val}` : val;
          }
        }
        if (!cancelled) scheduleReconnect();
      } catch (error) {
        if ((error as Error).name === 'AbortError' || cancelled) return;
        scheduleReconnect();
      }
    };

    connect();
    return () => {
      cancelled = true;
      controller?.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [qc]);
}
