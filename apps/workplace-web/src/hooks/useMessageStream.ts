// messaging 글로벌 SSE 구독 훅 — 유저당 스트림 1개로 본인이 멤버인 모든 채널 이벤트 수신.
// fetch + ReadableStream 으로 Authorization 헤더 전송(native EventSource 헤더 미지원).
// messaging.message.created 는 react-query messages 캐시를 channelId 로 직접 갱신.

import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAccessToken, refreshAccessToken } from '../api/client';
import type { MessagePage, MessageResponse } from '../types/messaging';
import { messagingKeys } from './queries/messagingKeys';

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

function handleEvent(qc: QueryClient, eventName: string, data: unknown) {
  const d = data as Record<string, unknown>;
  const channelId = Number(d.channelId);
  if (!channelId) return;
  if (eventName === 'messaging.message.created') {
    upsertMessage(qc, channelId, data as MessageResponse);
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
  }
}

export function useMessageStream() {
  const qc = useQueryClient();

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
              handleEvent(qc, currentEvent, JSON.parse(currentData));
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
