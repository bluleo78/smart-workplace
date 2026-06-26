// chat.* SSE 이벤트 핸들러 — 통합 스트림 라우터(Task 4)가 호출.
// 트랜스포트(fetch 루프·백오프·401) 제거, 캐시 변이 + 이벤트 버스 발행만 담당.
// 이벤트 버스(onChatTyping 등)와 타입 export 는 소비처 import 경로 보존을 위해 그대로 유지.

import { type InfiniteData, type QueryClient } from '@tanstack/react-query';

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

// chat.* SSE 이벤트를 react-query 캐시 변이 + 이벤트 버스 발행으로 처리한다(통합 스트림 라우터가 호출).
export function handleChatEvent(qc: QueryClient, eventName: string, data: unknown) {
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
