// 이슈 채팅 읽음 표시 — 호출처(ChatMessageList IntersectionObserver)가 마지막 메시지 진입 시 markRead(id) 를 부른다.
// useMarkMessageRead(채널/DM)와 같은 모양이되, 이슈 채팅은 스크롤 중 연속 발화를 1초 디바운스로 모아 마지막 id 하나만 보낸다.
// 중복 억제: 마지막으로 보낸 id(와 보류 중 id) 이하는 무시한다.
// 디바운스가 끝나기 전에 언마운트(이슈 전환 = key 리마운트, 드로워 닫기)되면 보류 중 id 를 한 번 보낸다 — 떠나는 스레드의 읽음 유실 방지.
// threadId 가 리마운트 없이 바뀌어도 같은 cleanup 이 이전 스레드 몫을 보내고 기준을 리셋한다(useMarkMessageRead 와 같은 방어선).
// 실패 시 되돌림·알림 정책은 reportReadFailure 참조(WP-1855) — 단, 실패한 요청 뒤에 더 큰 id 를 이미 보냈다면 기준(lastSent)을 되돌리지 않는다.
// 보낼 때 스레드 캐시(useChatThread)의 내 읽음 워터마크를 요청 전에 올리고(WP-1372, 낙관적 — WP-1914), 실패하면 되돌린다 —
// 채팅 버튼(IssueChatButton)의 읽지 않은 수가 이 캐시로 계산되어, 드로워를 닫은 직후에도 읽은 메시지가 다시 세지지 않는다.

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { chatApi } from '../../api/chat';
import type { ChatThreadResponse } from '../../types/chat';
import { chatKeys } from './chatKeys';
import { reportReadFailure } from './messageReadError';

/**
 * 스레드 응답의 내 읽음 워터마크(lastReadMessageId)를 uptoMessageId 까지 올린 사본. 바뀔 게 없으면(캐시 없음·내가 멤버 아님·
 * 이미 그 이상) undefined — setQueryData 갱신 함수가 undefined 를 돌려주면 캐시를 쓰지 않는다(구독자 다시 그리기 없음).
 * 서버 mark-read 와 같은 규칙(워터마크는 줄지 않는다)을 캐시에 반영한다. 테스트용으로 내보낸다.
 */
export function advanceLastRead(
  thread: ChatThreadResponse | undefined,
  userId: number,
  uptoMessageId: number,
): ChatThreadResponse | undefined {
  const current = myLastReadOf(thread, userId);
  if (!thread || current === undefined || current >= uptoMessageId) return undefined;
  return withMyLastRead(thread, userId, uptoMessageId);
}

/** 스레드 응답의 내 읽음 워터마크 — 캐시가 없거나 내가 멤버가 아니면 undefined. */
function myLastReadOf(thread: ChatThreadResponse | undefined, userId: number): number | undefined {
  const me = thread?.members?.find((m) => m.userId === userId);
  return me ? (me.lastReadMessageId ?? 0) : undefined;
}

/** 내 읽음 워터마크를 value 로 바꾼 사본 — 올리기(advanceLastRead)와 실패한 낙관적 올리기 되돌리기(줄어들 수 있다)가 함께 쓴다. */
function withMyLastRead(thread: ChatThreadResponse, userId: number, value: number): ChatThreadResponse {
  return { ...thread, members: thread.members.map((m) => (m.userId === userId ? { ...m, lastReadMessageId: value } : m)) };
}

/** 읽음 디바운스 — 1초. 스크롤로 마지막 메시지가 연달아 바뀌어도 요청은 멈춘 뒤 한 번. */
const READ_DEBOUNCE_MS = 1000;

/** 읽음이 반영될 스레드 캐시 — 이슈 좌표(useChatThread 키)와 내 사용자 id. */
export interface ChatReadCacheTarget {
  projectKey: string;
  issueNumber: number;
  userId: number;
}

export function useMarkChatRead(threadId: number, cache?: ChatReadCacheTarget) {
  const queryClient = useQueryClient();
  // 캐시 좌표 — 원시값으로 풀어 flush 의존성에 둔다(호출부 객체 리터럴이 렌더마다 새로 만들어져도 flush 가 바뀌지 않게).
  const cacheProject = cache?.projectKey;
  const cacheIssue = cache?.issueNumber;
  const cacheUser = cache?.userId;
  const lastSent = useRef(-1);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 보류 중 id 를 한 번 보낸다 — 타이머 발화·언마운트·스레드 전환이 모두 이 길을 타고, 보낸 뒤 비우므로 두 번 보내지 않는다.
  // 언마운트 뒤에도 불리므로 mutation 대신 API 를 직접 부른다(응답은 쓰지 않는다).
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = pending.current;
    pending.current = null;
    if (id === null || threadId <= 0 || id <= lastSent.current) return;
    const previous = lastSent.current; // 실패 시 되돌릴 기준(WP-1855)
    lastSent.current = id;
    // 캐시 워터마크를 요청 전에 올린다(낙관적) — 실패하면 아래 catch 에서 올리기 전 값으로 되돌린다. 언마운트 뒤에도 QueryClient 는 남아 있다.
    const target =
      cacheProject !== undefined && cacheIssue !== undefined && cacheUser !== undefined
        ? { key: chatKeys.thread(cacheProject, cacheIssue), user: cacheUser }
        : null;
    const before = target
      ? myLastReadOf(queryClient.getQueryData<ChatThreadResponse>(target.key), target.user)
      : undefined;
    if (target) {
      queryClient.setQueryData<ChatThreadResponse>(target.key, (old) => advanceLastRead(old, target.user, id));
    }
    chatApi.markRead(threadId, { uptoMessageId: id }).catch((err: unknown) => {
      // 내가 올린 값이 아직 그대로일 때만 되돌린다(그사이 더 큰 id 를 보냈거나 스레드를 다시 받았으면 그 값을 둔다).
      if (target && before !== undefined) {
        queryClient.setQueryData<ChatThreadResponse>(target.key, (old) =>
          old && myLastReadOf(old, target.user) === id ? withMyLastRead(old, target.user, before) : undefined,
        );
      }
      // 언마운트 뒤 실패도 같은 정책이다(ref 되돌림은 무해).
      reportReadFailure(err, () => {
        if (lastSent.current === id) lastSent.current = previous;
      });
    });
  }, [threadId, queryClient, cacheProject, cacheIssue, cacheUser]);

  // 언마운트·스레드 전환 시 남은 읽음을 보내고 중복 억제 기준을 리셋한다(메시지 id 는 전역 증가라 새 스레드의 작은 id 가 막히지 않게).
  useEffect(
    () => () => {
      flush();
      lastSent.current = -1;
    },
    [flush],
  );

  // 마지막 메시지 id 로 읽음 요청(디바운스). 미오픈 스레드·낙관적(음수) id·이미 보냈거나 보류 중인 id 이하는 무시.
  const markRead = useCallback(
    (uptoMessageId: number) => {
      if (threadId <= 0 || uptoMessageId <= 0) return;
      if (uptoMessageId <= Math.max(lastSent.current, pending.current ?? -1)) return;
      pending.current = uptoMessageId;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, READ_DEBOUNCE_MS);
    },
    [threadId, flush],
  );

  return markRead;
}
