// 이슈 채팅 읽음 표시 — 호출처(ChatMessageList IntersectionObserver)가 마지막 메시지 진입 시 markRead(id) 를 부른다.
// useMarkMessageRead(채널/DM)와 같은 모양이되, 이슈 채팅은 스크롤 중 연속 발화를 1초 디바운스로 모아 마지막 id 하나만 보낸다.
// 중복 억제: 마지막으로 보낸 id(와 보류 중 id) 이하는 무시한다.
// 디바운스가 끝나기 전에 언마운트(이슈 전환 = key 리마운트, 드로워 닫기)되면 보류 중 id 를 한 번 보낸다 — 떠나는 스레드의 읽음 유실 방지.
// threadId 가 리마운트 없이 바뀌어도 같은 cleanup 이 이전 스레드 몫을 보내고 기준을 리셋한다(useMarkMessageRead 와 같은 방어선).
// 응답 무시, 실패 시 silent — 다음 intersection 에서 재시도.
// 성공하면 스레드 캐시(useChatThread)의 내 읽음 워터마크를 올린다(WP-1372) — 채팅 버튼(IssueChatButton)의 읽지 않은 수가 이 캐시로
// 계산되므로, 드로워를 닫거나 개인 작업 채팅이 화면 밖으로 나가도 이미 읽은 메시지가 다시 세지지 않는다.

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { chatApi } from '../../api/chat';
import type { ChatThreadResponse } from '../../types/chat';
import { chatKeys } from './chatKeys';

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
  const me = thread?.members?.find((m) => m.userId === userId);
  if (!thread || !me || (me.lastReadMessageId ?? 0) >= uptoMessageId) return undefined;
  return {
    ...thread,
    members: thread.members.map((m) => (m.userId === userId ? { ...m, lastReadMessageId: uptoMessageId } : m)),
  };
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
    lastSent.current = id;
    chatApi
      .markRead(threadId, { uptoMessageId: id })
      .then(() => {
        // 성공한 읽음만 캐시에 반영한다(실패는 다음 intersection 에서 재시도). 언마운트 뒤에도 QueryClient 는 남아 있다.
        if (cacheProject === undefined || cacheIssue === undefined || cacheUser === undefined) return;
        queryClient.setQueryData<ChatThreadResponse>(chatKeys.thread(cacheProject, cacheIssue), (old) =>
          advanceLastRead(old, cacheUser, id),
        );
      })
      .catch(() => {});
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
