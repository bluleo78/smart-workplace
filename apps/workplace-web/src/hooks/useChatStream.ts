// chat 글로벌 SSE 구독 훅 — 유저당 스트림 1개로 본인이 멤버인 모든 thread 이벤트 수신.
// firehub useNotificationStream 패턴 재사용: fetch + ReadableStream 으로 Authorization 헤더 전송
// (native EventSource 는 커스텀 헤더 미지원).
// 메시지 created/updated/deleted 는 react-query messages 캐시를 threadId 로 직접 갱신.
// typing 은 모듈 이벤트 버스(chatTypingBus)로 컴포넌트에 전달.

import { type InfiniteData, type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getAccessToken, refreshAccessToken } from '../api/client';
import type { ChatMessagePage, ChatMessageResponse } from '../types/chat';
import { chatKeys } from './queries/chatKeys';

// 타이핑 이벤트 버스 — SSE 훅(앱 1곳)에서 발행, IssueChatSection 에서 구독.
export interface ChatTypingEvent {
  threadId: number;
  userId: number;
  name: string;
}
type TypingListener = (e: ChatTypingEvent) => void;
const typingListeners = new Set<TypingListener>();
export function onChatTyping(listener: TypingListener): () => void {
  typingListeners.add(listener);
  return () => {
    typingListeners.delete(listener);
  };
}
function emitTyping(e: ChatTypingEvent) {
  typingListeners.forEach((l) => l(e));
}

// 진행 이벤트 버스 — AI 에이전트 스트리밍 진행 상황을 컴포넌트에 전달.
// onChatProgress 로 구독, chat.message.progress SSE 이벤트 수신 시 emitProgress 로 발행.
export interface ChatProgressEvent {
  threadId: number;
  streamId: string;
  agentName: string;
  phase: 'started' | 'tool' | 'done' | 'error';
  steps: { label: string; status: 'running' | 'done' }[];
}
type ProgressListener = (e: ChatProgressEvent) => void;
const progressListeners = new Set<ProgressListener>();
export function onChatProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}
function emitProgress(e: ChatProgressEvent) {
  progressListeners.forEach((l) => l(e));
}

// 메시지 생성 이벤트 버스 — 접힘 채팅 패널의 미읽음 배지 카운트용(#352).
// messageId 를 함께 실어, 스트림 재연결 시 동일 created 가 재수신돼도 구독측에서 dedup 가능.
export interface ChatMessageCreatedEvent {
  threadId: number;
  messageId: number;
  authorId: number;
}
type CreatedListener = (e: ChatMessageCreatedEvent) => void;
const createdListeners = new Set<CreatedListener>();
export function onChatMessageCreated(listener: CreatedListener): () => void {
  createdListeners.add(listener);
  return () => {
    createdListeners.delete(listener);
  };
}
function emitCreated(e: ChatMessageCreatedEvent) {
  createdListeners.forEach((l) => l(e));
}

// messages 캐시 첫 페이지에 메시지 prepend (없으면 무시 — 열려있지 않은 thread).
function upsertMessage(qc: QueryClient, threadId: number, msg: ChatMessageResponse) {
  const key = chatKeys.messages(threadId);
  qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
    if (!old) return old; // 해당 thread 미오픈 → 열 때 refetch 로 정합
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

function patchMessage(
  qc: QueryClient,
  threadId: number,
  id: number,
  patch: Partial<ChatMessageResponse>,
) {
  const key = chatKeys.messages(threadId);
  qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
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
  const threadId = Number(d.threadId);
  if (!threadId) return;
  switch (eventName) {
    case 'chat.message.created': {
      const m = data as ChatMessageResponse;
      upsertMessage(qc, threadId, m);
      // 접힘 채팅 패널 미읽음 배지용 — id 동반(재연결 시 중복 카운트 dedup).
      emitCreated({ threadId, messageId: Number(m.id), authorId: Number(m.authorId) });
      break;
    }
    case 'chat.message.updated':
      patchMessage(qc, threadId, Number(d.id), {
        body: String(d.body),
        mentions: (d.mentions ?? []) as ChatMessageResponse['mentions'],
        editedAt: (d.editedAt as string | null) ?? null,
      });
      break;
    case 'chat.message.deleted':
      patchMessage(qc, threadId, Number(d.id), { deleted: true });
      break;
    case 'chat.thread.typing':
      emitTyping({ threadId, userId: Number(d.userId), name: String(d.name) });
      break;
    case 'chat.message.progress':
      // AI 에이전트 스트리밍 진행 — progress 버스로 ghost bubble 컴포넌트에 전달.
      emitProgress({
        threadId,
        streamId: String(d.streamId),
        agentName: String(d.agentName ?? 'AI'),
        phase: d.phase as ChatProgressEvent['phase'],
        steps: (d.steps ?? []) as ChatProgressEvent['steps'],
      });
      break;
    // chat.thread.read 는 현재 UI 에 읽음 표시가 없어 캐시 갱신 생략 (열 때 thread refetch 로 정합).
  }
}

export function useChatStream() {
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
        const response = await fetch('/api/v1/chat/stream', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
          credentials: 'include',
        });
        if (response.status === 401) {
          // access token 만료 — raw fetch 는 axios refresh 인터셉터를 안 타므로 직접 갱신 후 재연결.
          const refreshed = await refreshAccessToken();
          if (!refreshed) {
            cancelled = true; // refresh 실패 → 다음 axios 호출이 로그인으로 보냄. SSE 루프 종료.
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
