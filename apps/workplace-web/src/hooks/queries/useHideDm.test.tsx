// DM 숨기기(WP-1676) — 성공하면 DM 목록·안 읽음 요약을 다시 받고, 404(이미 나갔거나 없는 DM)는 성공으로 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/messaging', () => ({ messagingApi: { hideDm: vi.fn() } }));
vi.mock('../../lib/api-error', async (orig) => ({ ...(await orig<object>()), handleApiError: vi.fn() }));

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { messagingKeys } from './messagingKeys';
import { useHideDm } from './useHideDm';

function apiError(status: number) {
  return new AxiosError('x', String(status), undefined, undefined, {
    status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: { status, message: 'x' },
  });
}

/** 숨기기를 한 번 부르고, 무효화한 쿼리 키와 호출처 onSuccess 가 불렸는지를 돌려준다. */
async function hide(rejection?: AxiosError) {
  vi.mocked(handleApiError).mockClear();
  if (rejection) vi.mocked(messagingApi.hideDm).mockRejectedValueOnce(rejection);
  else vi.mocked(messagingApi.hideDm).mockResolvedValueOnce({ data: undefined } as never);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useHideDm(), { wrapper });
  const onSuccess = vi.fn();
  await act(async () => {
    await result.current.mutateAsync(7, { onSuccess }).catch(() => undefined);
  });
  return {
    keys: spy.mock.calls.map((args) => JSON.stringify((args[0] as { queryKey?: unknown }).queryKey)),
    onSuccess,
  };
}

describe('useHideDm', () => {
  it('성공하면 그 DM 을 숨기라고 보내고 DM 목록·안 읽음 요약을 무효화한다', async () => {
    const { keys, onSuccess } = await hide();
    expect(messagingApi.hideDm).toHaveBeenLastCalledWith(7);
    expect(keys).toEqual([JSON.stringify(messagingKeys.dms()), JSON.stringify(['messaging-summary'])]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(handleApiError).not.toHaveBeenCalled();
  });

  it('404 는 성공으로 보고 목록만 갱신하며 오류 토스트를 띄우지 않는다', async () => {
    const { keys, onSuccess } = await hide(apiError(404));
    expect(keys).toEqual([JSON.stringify(messagingKeys.dms()), JSON.stringify(['messaging-summary'])]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(handleApiError).not.toHaveBeenCalled();
  });

  it('그 밖의 실패(500)는 오류 토스트를 띄우고 목록을 건드리지 않는다', async () => {
    const { keys, onSuccess } = await hide(apiError(500));
    expect(keys).toEqual([]);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(handleApiError).toHaveBeenCalledTimes(1);
  });
});
