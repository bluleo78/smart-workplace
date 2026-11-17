// 채널 나가기 404 멱등 처리(WP-1402) — 서버가 비공개 채널 비멤버의 나가기에 404 를 돌려도 사용자에겐 성공이다.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
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
  // 그룹 DM 나가기(WP-1677)도 이 훅을 쓰므로 DM 목록·안 읽음 요약도 함께 갱신한다.
  it('404 는 성공으로 보고 채널·DM 목록을 갱신하며 오류 토스트를 띄우지 않는다', async () => {
    vi.mocked(handleApiError).mockClear();
    expect(await leave(apiError(404))).toEqual([
      JSON.stringify(messagingKeys.dms()),
      JSON.stringify(['messaging-summary']),
      JSON.stringify(messagingKeys.channels()),
    ]);
    expect(handleApiError).not.toHaveBeenCalled();
  });

  it('409(소유권 이전 필요)는 여전히 오류로 처리한다', async () => {
    vi.mocked(handleApiError).mockClear();
    expect(await leave(apiError(409))).toEqual([]);
    expect(handleApiError).toHaveBeenCalledTimes(1);
  });

  /**
   * 채널 목록 재조회가 끝나지 않은 동안 mutateAsync 가 끝나는지 본다. 채널 목록 쿼리를 화면에 걸어 두고(무효화가 재조회하도록),
   * 나간 뒤의 재조회 응답은 release 전까지 멈춘다.
   */
  async function settlesBeforeChannelsRefetch(options?: { awaitRefetch?: boolean }) {
    vi.mocked(messagingApi.leaveChannel).mockResolvedValueOnce({ data: undefined } as never);
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    let release: () => void = () => {};
    let calls = 0;
    const queryFn = () => {
      calls += 1;
      // 첫 조회는 바로, 나간 뒤 재조회는 release 까지 멈춘다.
      return calls === 1 ? Promise.resolve([]) : new Promise<never[]>((r) => { release = () => r([]); });
    };
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(
      () => ({ list: useQuery({ queryKey: messagingKeys.channels(), queryFn }), leave: useLeaveChannel(options) }),
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    let settled = false;
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.leave.mutateAsync(7).then(() => { settled = true; });
      // 재조회가 멈춘 동안 마이크로태스크를 충분히 흘려보낸다.
      await new Promise((r) => setTimeout(r, 50));
    });
    const before = settled;
    await act(async () => {
      release();
      await done;
    });
    return before;
  }

  // 채널 멤버 창(ChannelMembersPanel)은 mutateAsync 뒤 /chat 으로 간다 — 갱신된 채널 목록을 본 뒤 가도록 재조회를 기다린다.
  it('기본은 채널 목록 재조회가 끝난 뒤에 끝난다', async () => {
    expect(await settlesBeforeChannelsRefetch()).toBe(false);
  });

  // 그룹 DM 나가기(WP-1677)는 기다리지 않는다 — 기다리는 사이 DM 화면이 「대화를 찾을 수 없습니다」로 잠깐 바뀌지 않게.
  it('awaitRefetch: false 면 채널 목록 재조회를 기다리지 않는다', async () => {
    expect(await settlesBeforeChannelsRefetch({ awaitRefetch: false })).toBe(true);
  });
});
