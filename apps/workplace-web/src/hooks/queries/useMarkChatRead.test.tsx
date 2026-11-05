// useMarkChatRead — 1초 디바운스·중복 억제·언마운트 flush 가 읽음 요청을 정확히 한 번만 보내는지.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createChatMember, createChatThread } from '../../../e2e/factories/chat.factory';
import { chatApi } from '../../api/chat';
import type { ChatThreadResponse } from '../../types/chat';
import { chatKeys } from './chatKeys';
import { advanceLastRead, useMarkChatRead } from './useMarkChatRead';

/** 훅이 스레드 캐시를 쓰므로 QueryClient 로 감싼다 — 테스트마다 새 캐시. */
function withClient(client = new QueryClient()) {
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
}

describe('useMarkChatRead', () => {
  let markRead: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    markRead = vi.spyOn(chatApi, 'markRead').mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('1초 안의 연속 요청은 마지막 id 하나로 모아 보낸다', () => {
    const { result } = renderHook(() => useMarkChatRead(100), withClient());
    result.current(10);
    result.current(20);
    vi.advanceTimersByTime(999);
    expect(markRead).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(markRead).toHaveBeenCalledExactlyOnceWith(100, { uptoMessageId: 20 });
  });

  it('보낸 id 이하·0 이하 id·미오픈 스레드는 보내지 않는다', () => {
    const { result } = renderHook(() => useMarkChatRead(100), withClient());
    result.current(20);
    vi.advanceTimersByTime(1000);
    result.current(20);
    result.current(5);
    result.current(-3);
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenCalledTimes(1);

    const unopened = renderHook(() => useMarkChatRead(0), withClient());
    unopened.result.current(30);
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('디바운스 중 언마운트하면 보류 id 를 한 번만 보낸다', () => {
    const { result, unmount } = renderHook(() => useMarkChatRead(100), withClient());
    result.current(50);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenCalledExactlyOnceWith(100, { uptoMessageId: 50 });
  });

  it('이미 보낸 뒤 언마운트하면 다시 보내지 않는다', () => {
    const { result, unmount } = renderHook(() => useMarkChatRead(100), withClient());
    result.current(50);
    vi.advanceTimersByTime(1000);
    unmount();
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('리마운트 없이 스레드가 바뀌면 이전 스레드 몫을 보내고 기준을 리셋한다', () => {
    const { result, rerender } = renderHook(({ id }) => useMarkChatRead(id), { initialProps: { id: 100 }, ...withClient() });
    result.current(500);
    rerender({ id: 200 });
    expect(markRead).toHaveBeenCalledExactlyOnceWith(100, { uptoMessageId: 500 });
    result.current(30);
    vi.advanceTimersByTime(1000);
    expect(markRead).toHaveBeenLastCalledWith(200, { uptoMessageId: 30 });
  });

  it('보내기에 성공하면 스레드 캐시의 내 읽음 워터마크를 올리고, 실패면 그대로 둔다', async () => {
    const { client, wrapper } = withClient();
    const key = chatKeys.thread('P1', 4);
    client.setQueryData(key, createChatThread({ members: [createChatMember({ userId: 1, lastReadMessageId: 10 })] }));
    const myLastRead = () => client.getQueryData<ChatThreadResponse>(key)?.members[0].lastReadMessageId;
    const { result } = renderHook(() => useMarkChatRead(100, { projectKey: 'P1', issueNumber: 4, userId: 1 }), { wrapper });
    result.current(30);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(myLastRead()).toBe(30));

    markRead.mockRejectedValueOnce(new Error('boom'));
    result.current(40);
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(myLastRead()).toBe(30);
  });
});

describe('advanceLastRead', () => {
  const thread = createChatThread({
    members: [createChatMember({ userId: 1, lastReadMessageId: 10 }), createChatMember({ userId: 2, lastReadMessageId: 3 })],
  });

  it('내 워터마크만 올리고 다른 멤버는 그대로', () => {
    const next = advanceLastRead(thread, 1, 25);
    expect(next?.members.map((m) => m.lastReadMessageId)).toEqual([25, 3]);
  });

  it('바뀔 게 없으면(워터마크가 이미 그 이상·내가 멤버 아님·캐시 없음) undefined — 캐시를 쓰지 않는다', () => {
    expect(advanceLastRead(thread, 1, 5)).toBeUndefined();
    expect(advanceLastRead(thread, 9, 50)).toBeUndefined();
    expect(advanceLastRead(undefined, 1, 50)).toBeUndefined();
  });
});
