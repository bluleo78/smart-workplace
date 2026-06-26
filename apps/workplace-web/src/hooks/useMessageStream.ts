// messaging.* SSE 이벤트 핸들러 — 통합 스트림 라우터(Task 4)가 호출.
// 트랜스포트(fetch 루프·백오프·401) 제거, 캐시 변이 + 이벤트 버스 발행만 담당.
// 이벤트 버스(onMessagingProgress 등)와 타입 export 는 소비처 import 경로 보존을 위해 그대로 유지.
// Phase 5: 스레드 답글 라우팅(parentMessageId) + 리액션 이벤트 패치.

import { type InfiniteData, type QueryClient } from '@tanstack/react-query';

import { applyReaction } from '../lib/reactions';
import type { MessagePage, MessageResponse } from '../types/messaging';
import { messagingKeys } from './queries/messagingKeys';
import { bumpReplyCount, bumpUnreadReplyCount, isParentFollowed } from './queries/useCreateReply';
import { patchReactionEverywhere } from './queries/useToggleReaction';

// 메시징 진행 이벤트 버스 — AI 에이전트 스트리밍 진행 상황을 컴포넌트에 전달.
// onMessagingProgress 로 구독, messaging.message.progress SSE 이벤트 수신 시 emitMessagingProgress 로 발행.
export interface MessagingProgressEvent {
  channelId: number;
  streamId: string;
  agentName: string;
  phase: 'started' | 'tool' | 'done' | 'error';
  steps: { label: string; status: 'running' | 'done' }[];
}
type MessagingProgressListener = (e: MessagingProgressEvent) => void;
const messagingProgressListeners = new Set<MessagingProgressListener>();
export function onMessagingProgress(listener: MessagingProgressListener): () => void {
  messagingProgressListeners.add(listener);
  return () => {
    messagingProgressListeners.delete(listener);
  };
}
function emitMessagingProgress(e: MessagingProgressEvent) {
  messagingProgressListeners.forEach((l) => l(e));
}

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
// 채널 캐시와 스레드 캐시 모두에 적용 — 답글은 thread 캐시에만 존재하므로 양쪽 모두 필요.
function patchMessage(
  qc: QueryClient,
  channelId: number,
  id: number,
  patch: Partial<MessageResponse>,
) {
  const apply = (old?: InfiniteData<MessagePage>) =>
    !old
      ? old
      : {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          })),
        };
  qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId), apply);
  qc.setQueriesData<InfiniteData<MessagePage>>({ queryKey: messagingKeys.threads() }, apply);
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

// messaging.* SSE 이벤트를 처리한다(통합 스트림 라우터가 호출). currentUserId 로 self-echo·본인 읽음을 가린다.
export function handleMessagingEvent(
  qc: QueryClient,
  eventName: string,
  data: unknown,
  currentUserId: number,
) {
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
      // 내가 팔로우하는 스레드이고 내 답글이 아닐 때만 미읽음 +1(부모 캐시 confirmed=followed 확인).
      if (msg.authorId !== currentUserId && isParentFollowed(qc, channelId, msg.parentMessageId)) {
        bumpUnreadReplyCount(qc, channelId, msg.parentMessageId, +1);
      }
    } else {
      upsertMessage(qc, channelId, msg);
    }
    // 미오픈 채널 포함 사이드바 배지 갱신.
    invalidateLists(qc);
    // 인박스(크로스채널 미읽음 스레드)도 답글 생성 시 갱신.
    qc.invalidateQueries({ queryKey: messagingKeys.threadsInbox() });
    qc.invalidateQueries({ queryKey: messagingKeys.threadsInboxUnreadCount() });
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
    // 인박스(크로스채널 미읽음 스레드)도 답글 삭제 시 갱신.
    qc.invalidateQueries({ queryKey: messagingKeys.threadsInbox() });
    qc.invalidateQueries({ queryKey: messagingKeys.threadsInboxUnreadCount() });
  } else if (eventName === 'messaging.message.progress') {
    // AI 에이전트 스트리밍 진행 — progress 버스로 ghost bubble 컴포넌트에 전달.
    emitMessagingProgress({
      channelId,
      streamId: String(d.streamId),
      agentName: String(d.agentName ?? 'AI'),
      phase: d.phase as MessagingProgressEvent['phase'],
      steps: (d.steps ?? []) as MessagingProgressEvent['steps'],
    });
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
