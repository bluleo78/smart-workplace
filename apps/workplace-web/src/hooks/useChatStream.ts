// chat.* SSE 이벤트 핸들러 — 통합 스트림 라우터(Task 4)가 호출.
// 트랜스포트(fetch 루프·백오프·401) 제거, 캐시 변이 + 이벤트 버스 발행만 담당.
// 이벤트 버스(onChatTyping 등)와 타입 export 는 소비처 import 경로 보존을 위해 그대로 유지.

import { type InfiniteData, type Query, type QueryClient } from '@tanstack/react-query';

import { keyedSubscribe } from '../lib/aiWorkingProgress';
import type { ChatMessagePage, ChatMessageResponse, ChatThreadResponse } from '../types/chat';
import type { MessageAttachment } from '../types/messaging';
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
/** 한 이슈 채팅 스레드(threadId)의 진행 이벤트만 받는 구독 — useAiWorkingBubbles 의 subscribe 인자(WP-418). */
export const onThreadProgress = keyedSubscribe(onChatProgress, (e) => e.threadId);
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

// 메시지 목록(최신순 = id 내림차순) 에 메시지를 반영하는 순수 함수 — 같은 id 가 있으면 바꾸고, 없으면 id 순서 자리에 넣는다.
// 스레드 캐시 recentMessages 는 같은 created 를 재연결로 다시 받을 수 있어 이 규칙으로 중복을 막고,
// 재연결로 옛 created 를 늦게 받아도 맨 앞이 아니라 제자리에 들어가 시드 순서가 뒤집히지 않는다.
// - 보내는 중인 내 메시지(낙관적 음수 임시 id)는 맨 위에 그대로 두고 그 아래 실제 id 들 사이에서 자리를 찾는다.
// - 담긴 실제 메시지보다 모두 오래된 메시지는 넣지 않는다 — 그 메시지는 이 목록 뒤(더 옛 페이지)에 있고,
//   끝에 붙이면 옛 페이지를 불러올 때 두 번 보인다.
function upsertItem(items: ChatMessageResponse[], msg: ChatMessageResponse): ChatMessageResponse[] {
  if (items.some((m) => m.id === msg.id)) return items.map((m) => (m.id === msg.id ? msg : m));
  const at = items.findIndex((m) => m.id > 0 && m.id < msg.id);
  if (at >= 0) return [...items.slice(0, at), msg, ...items.slice(at)];
  return items.some((m) => m.id > 0) ? items : [...items, msg];
}

// 스레드 캐시(chatKeys.thread) 중 해당 threadId 의 recentMessages 를 update 로 고친다.
// 서랍은 열 때 이 recentMessages 로 messages 캐시를 시드하고 staleTime 안에서는 refetch 하지 않으므로,
// 받은 이벤트를 여기에도 반영해 두어야 열었을 때 보인다(WP-1914). messages 캐시가 있을 때도 함께 고친다 —
// 닫힌 서랍의 messages 캐시가 gcTime 뒤 지워지면 다음 시드는 다시 이 recentMessages 에서 오기 때문이다.
function updateThreadRecent(
  qc: QueryClient,
  threadId: number,
  update: (items: ChatMessageResponse[]) => ChatMessageResponse[],
) {
  for (const q of qc.getQueryCache().findAll({ queryKey: chatKeys.threads() })) {
    applyThreadRecent(qc, q, threadId, update);
  }
}

// 스레드 쿼리 하나에 updateThreadRecent 를 적용한다.
function applyThreadRecent(
  qc: QueryClient,
  q: Query,
  threadId: number,
  update: (items: ChatMessageResponse[]) => ChatMessageResponse[],
) {
  const data = q.state.data as ChatThreadResponse | undefined;
  // 다른 스레드로 이미 받은 쿼리는 볼 것이 없다(가져오는 중이어도 기다리지 않는다 — 이벤트마다 기다림을 걸지 않게).
  if (data && data.threadId !== threadId) return;
  // 가져오는 중(오프라인으로 멈춘 paused 포함)이면 지금 쓴 값은 응답에 덮이고, 응답이 이 이벤트보다 먼저 만들어졌을 수 있다 —
  // 가져오기가 끝난 뒤(성공·실패 모두) 그 쿼리에 다시 반영한다. 첫 가져오기라 아직 data(threadId)가 없어도
  // 이 스레드일 수 있으므로 기다린다. update 는 두 번 반영해도 결과가 같다(같은 id 는 바꿈).
  if (q.state.fetchStatus !== 'idle') {
    const retry = () => {
      // 그사이 캐시에서 빠진 쿼리에는 쓰지 않는다(setQueryData 가 새 쿼리를 만들지 않게).
      if (qc.getQueryCache().get(q.queryHash) === q) applyThreadRecent(qc, q, threadId, update);
    };
    void q.promise?.then(retry, retry);
    return;
  }
  if (data?.threadId !== threadId || !Array.isArray(data.recentMessages)) return;
  // setQueryData 는 무효화 표시를 지우므로(멤버 변경 등으로 걸린 다음 refetch 가 사라진다) 쓰기 뒤 다시 건다(요청은 보내지 않음).
  const wasInvalidated = q.state.isInvalidated;
  // updatedAt 을 원래 값으로 유지한다 — 서랍이 initialDataUpdatedAt 으로 시드 신선도를 판단하므로,
  // 시각을 올리면 재연결 사이 놓친 메시지가 있는 시드가 신선한 것으로 보여 refetch 가 생략된다.
  qc.setQueryData<ChatThreadResponse>(
    q.queryKey,
    { ...data, recentMessages: update(data.recentMessages) },
    { updatedAt: q.state.dataUpdatedAt },
  );
  if (wasInvalidated) q.invalidate();
}

// 새 메시지(또는 재수신)를 반영한다 — 스레드 캐시 recentMessages 와, 있으면 messages 캐시 첫 페이지.
function upsertMessage(qc: QueryClient, threadId: number, msg: ChatMessageResponse) {
  updateThreadRecent(qc, threadId, (items) => upsertItem(items, msg));
  qc.setQueryData<InfiniteData<ChatMessagePage>>(chatKeys.messages(threadId), (old) => {
    if (!old) return old; // messages 캐시 없음(서랍을 연 적 없음) — 열 때 위 스레드 캐시로 시드된다
    const exists = old.pages.some((p) => p.items.some((m) => m.id === msg.id));
    if (exists) {
      return {
        ...old,
        // 이미 있는 메시지는 그 페이지에서만 바꾼다(다른 페이지에 복제 금지).
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.map((m) => (m.id === msg.id ? msg : m)),
        })),
      };
    }
    const [first, ...rest] = old.pages;
    return { ...old, pages: [{ ...first, items: upsertItem(first.items, msg) }, ...rest] };
  });
}

// 메시지 하나의 일부 필드를 고친다 — 스레드 캐시 recentMessages 와, 있으면 messages 캐시.
function patchMessage(
  qc: QueryClient,
  threadId: number,
  id: number,
  patch: Partial<ChatMessageResponse>,
) {
  const apply = (items: ChatMessageResponse[]) => items.map((m) => (m.id === id ? { ...m, ...patch } : m));
  updateThreadRecent(qc, threadId, apply);
  qc.setQueryData<InfiniteData<ChatMessagePage>>(chatKeys.messages(threadId), (old) => {
    if (!old) return old;
    return { ...old, pages: old.pages.map((p) => ({ ...p, items: apply(p.items) })) };
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
        // WP-1680: 수정 뒤 첨부 전체 목록 — 키가 있을 때만 통째로 바꾼다(없으면 옛 서버 payload 라 첨부를 건드리지 않는다).
        ...('attachments' in d ? { attachments: (d.attachments ?? []) as MessageAttachment[] } : {}),
      });
      break;
    case 'chat.message.options':
      // WP-1569: 서버가 질문 글에서 답 선택지를 뒤늦게 뽑아 저장했다 — 그 메시지의 options 만 바꾼다.
      // chat.message.updated 를 쓰지 않는 이유: 그 처리기는 body·mentions·editedAt 을 덮어쓴다.
      patchMessage(qc, threadId, Number(d.messageId), {
        options: Array.isArray(d.options) ? d.options.map(String) : null,
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
