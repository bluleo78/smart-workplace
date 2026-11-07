// 채널 나가기 404 멱등 처리(WP-1402) — 서버가 비공개 채널 비멤버의 나가기에 404 를 돌려도 사용자에겐 성공이다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/messaging', () => ({ messagingApi: { leaveChannel: vi.fn() } }));
vi.mock('../../lib/api-error', async (orig) => ({ ...(await orig<object>()), handleApiError: vi.fn() }));

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { messagingKeys } from './messagingKeys';
import { useLeaveChannel } from './useChannelMutations';

function apiError(status: number) {
  return new AxiosError('x', String(status), undefined, undefined, {
    status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: { status, message: 'x' },
  });
}

async function leave(rejection?: AxiosError) {
  if (rejection) vi.mocked(messagingApi.leaveChannel).mockRejectedValueOnce(rejection);
  else vi.mocked(messagingApi.leaveChannel).mockResolvedValueOnce({ data: undefined } as never);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useLeaveChannel(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync(7).catch(() => undefined);
  });
  return spy.mock.calls.map((args) => JSON.stringify((args[0] as { queryKey?: unknown }).queryKey));
}

describe('useLeaveChannel', () => {
  it('404 는 성공으로 보고 채널 목록을 갱신하며 오류 토스트를 띄우지 않는다', async () => {
    vi.mocked(handleApiError).mockClear();
    expect(await leave(apiError(404))).toEqual([JSON.stringify(messagingKeys.channels())]);
    expect(handleApiError).not.toHaveBeenCalled();
  });

  it('409(소유권 이전 필요)는 여전히 오류로 처리한다', async () => {
    vi.mocked(handleApiError).mockClear();
    expect(await leave(apiError(409))).toEqual([]);
    expect(handleApiError).toHaveBeenCalledTimes(1);
  });
});
