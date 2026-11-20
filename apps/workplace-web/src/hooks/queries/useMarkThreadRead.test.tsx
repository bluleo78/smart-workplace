// useMarkThreadRead — 실패 시 미읽음 수 되돌리기·오류 토스트·중복 발화 억제(WP-1855).
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMessage } from '../../../e2e/factories/messaging.factory';
import { messagingApi } from '../../api/messaging';
import { httpError } from '../../test/httpError';
import type { MessagePage } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';
import { useMarkThreadRead } from './useMarkThreadRead';

/** 부모 메시지(id 9, 미읽음 답글 3)가 든 캐시를 가진 client. */
function makeClient() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const data = {
    pages: [{ items: [createMessage({ id: 9, unreadReplyCount: 3 })] }],
    pageParams: [undefined],
  } as unknown as InfiniteData<MessagePage>;
  client.setQueryData(messagingKeys.messages(1), data);
  return client;
}

function unreadOf(client: QueryClient): number {
  const d = client.getQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(1));
  return d!.pages[0].items[0].unreadReplyCount;
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useMarkThreadRead', () => {
  let markThreadRead: ReturnType<typeof vi.spyOn>;
  let toastError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    markThreadRead = vi.spyOn(messagingApi, 'markThreadRead');
    toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('실패하면 미읽음 수를 되돌리고 오류 토스트를 띄운다 (WP-1855)', async () => {
    markThreadRead.mockRejectedValue(httpError(500));
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    result.current(9, 3);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('읽음 처리하지 못했습니다', { id: 'message-read-error' }));
    expect(unreadOf(client)).toBe(3);
    // 실패해도 사이드바·인박스를 서버 값으로 맞추는 무효화는 돈다.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: messagingKeys.channels() });
  });

  it('실패한 스레드는 같은 마운트에서 다시 보내지 않고, 다시 마운트하면 보낸다 (WP-1855)', async () => {
    markThreadRead.mockRejectedValue(httpError(500));
    const client = makeClient();
    const first = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    first.result.current(9, 3);
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    first.result.current(9, 3);
    await new Promise((r) => setTimeout(r, 20));
    expect(markThreadRead).toHaveBeenCalledTimes(1);
    first.unmount();
    const second = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    second.result.current(9, 3);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(2));
  });

  it('보내는 중인 스레드는 다시 보내지 않는다 (WP-1855)', async () => {
    markThreadRead.mockImplementation(() => new Promise(() => {}));
    const client = makeClient();
    const { result } = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    result.current(9, 3);
    result.current(9, 3);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(markThreadRead).toHaveBeenCalledTimes(1);
  });

  it('성공하면 미읽음 수는 0 으로 남는다', async () => {
    markThreadRead.mockResolvedValue(undefined as never);
    const client = makeClient();
    const { result } = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    result.current(9, 3);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(unreadOf(client)).toBe(0);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('스레드를 A→B 로 바꾼 뒤 A 가 실패해도 A 를 복원·알리고, A 로 돌아오면 다시 보낸다 (WP-1855)', async () => {
    let rejectA: (e: unknown) => void = () => {};
    markThreadRead
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectA = reject; }))
      .mockImplementation(() => new Promise(() => {}));
    const client = makeClient();
    const { result } = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    result.current(9, 3);
    result.current(10, 1);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(2));
    rejectA(httpError(500));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(unreadOf(client)).toBe(3);
    // 같은 패널(마운트)에서 다른 스레드를 거쳐 A 로 돌아오면 실패 기록이 비워져 다시 보낸다.
    result.current(9, 3);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(3));
    expect(markThreadRead).toHaveBeenLastCalledWith(9);
  });

  it('패널이 닫힌(언마운트) 뒤 실패해도 미읽음 수를 복원하고 알린다 (WP-1855)', async () => {
    let rejectIt: (e: unknown) => void = () => {};
    markThreadRead.mockImplementationOnce(() => new Promise((_, reject) => { rejectIt = reject; }));
    const client = makeClient();
    const { result, unmount } = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    result.current(9, 3);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(1));
    unmount();
    rejectIt(httpError(500));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(unreadOf(client)).toBe(3);
  });

  it('영구 4xx(403)로 실패해도 미읽음 수는 복원하되 토스트는 띄우지 않는다 (WP-1855)', async () => {
    markThreadRead.mockRejectedValue(httpError(403));
    const client = makeClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useMarkThreadRead(1), { wrapper: wrapperFor(client) });
    result.current(9, 3);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: messagingKeys.channels() }));
    expect(unreadOf(client)).toBe(3);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('복원은 호출 시점의 채널에 한다 — 비행 중 채널이 바뀌어도 (WP-1855)', async () => {
    let rejectIt: (e: unknown) => void = () => {};
    markThreadRead.mockImplementationOnce(() => new Promise((_, reject) => { rejectIt = reject; }));
    const client = makeClient();
    const { result, rerender } = renderHook(({ ch }) => useMarkThreadRead(ch), {
      wrapper: wrapperFor(client),
      initialProps: { ch: 1 },
    });
    result.current(9, 3);
    await waitFor(() => expect(markThreadRead).toHaveBeenCalledTimes(1));
    expect(unreadOf(client)).toBe(0);
    rerender({ ch: 2 });
    rejectIt(httpError(500));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(unreadOf(client)).toBe(3);
  });
});
