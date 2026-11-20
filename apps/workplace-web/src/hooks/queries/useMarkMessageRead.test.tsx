// useMarkMessageRead — 중복 억제와, 실패 시 기준 되돌리기·오류 토스트(WP-1855).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messagingApi } from '../../api/messaging';
import { httpError } from '../../test/httpError';
import { useMarkMessageRead } from './useMarkMessageRead';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useMarkMessageRead', () => {
  let markRead: ReturnType<typeof vi.spyOn>;
  let toastError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    markRead = vi.spyOn(messagingApi, 'markRead');
    toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('읽음 요청이 실패하면 오류 토스트를 띄우고 같은 id 를 다시 보낼 수 있다 (WP-1855)', async () => {
    markRead.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useMarkMessageRead(1), { wrapper });
    result.current(5);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('읽음 처리하지 못했습니다', { id: 'message-read-error' }));
    result.current(5);
    // mutationFn 은 비동기로 호출되므로 호출을 기다린다.
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    expect(markRead).toHaveBeenLastCalledWith(1, 5);
  });

  it('성공한 id 이하는 다시 보내지 않는다', async () => {
    markRead.mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useMarkMessageRead(1), { wrapper });
    result.current(5);
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    result.current(5);
    result.current(3);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  it('실패한 요청보다 큰 id 를 그 사이 보냈으면 기준을 되돌리지 않는다 (WP-1855)', async () => {
    let rejectFirst: (e: unknown) => void = () => {};
    markRead
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce(undefined as never);
    const { result } = renderHook(() => useMarkMessageRead(1), { wrapper });
    result.current(5);
    result.current(7);
    // 첫 요청의 mutationFn 이 실제로 호출돼 reject 핸들이 잡힐 때까지 기다린다.
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    rejectFirst(httpError(500));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    result.current(5);
    result.current(7);
    // 되돌리지 않았으므로 5·7 모두 억제 — 추가 호출이 없음을 한 틱 흘려 확인한다.
    await new Promise((r) => setTimeout(r, 20));
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it('영구 4xx(403)로 실패하면 토스트 없이 조용하고, 같은 id 도 다시 보내지 않는다 (WP-1855)', async () => {
    markRead.mockRejectedValue(httpError(403));
    const { result } = renderHook(() => useMarkMessageRead(1), { wrapper });
    result.current(5);
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    result.current(5);
    await new Promise((r) => setTimeout(r, 20));
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });
});
