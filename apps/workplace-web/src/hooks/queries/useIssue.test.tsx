// 이슈 수정 실패 처리(WP-936) — 409 STATUS_DELETED·400 STATUS_NOT_FOUND 는 상태 목록만 다시 받고, 코드 없는 409(버전 충돌 #611)만 이슈·목록을 다시 받는다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/issues', () => ({ issuesApi: { update: vi.fn() } }));
vi.mock('../../lib/api-error', async (orig) => ({ ...(await orig<object>()), handleApiError: vi.fn() }));

import { issuesApi } from '../../api/issues';
import { useUpdateIssue } from './useIssue';

function apiError(status: number, code?: string) {
  const data = { status, message: 'x', ...(code ? { errors: { code } } : {}) };
  return new AxiosError('x', String(status), undefined, undefined, {
    status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data,
  });
}

// 실패한 수정 한 번 뒤 무효화된 쿼리 키들(JSON 문자열).
async function invalidatedKeysAfter(error: AxiosError) {
  vi.mocked(issuesApi.update).mockRejectedValueOnce(error);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useUpdateIssue('WP', 1), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ title: 't' }).catch(() => undefined);
  });
  return spy.mock.calls.map((args) => JSON.stringify((args[0] as { queryKey?: unknown }).queryKey));
}

describe('useUpdateIssue 409 처리', () => {
  it('STATUS_DELETED 면 상태 목록만 다시 받는다 — 이슈 상세·목록은 건드리지 않는다', async () => {
    expect(await invalidatedKeysAfter(apiError(409, 'STATUS_DELETED'))).toEqual(['["projectStatuses","WP"]']);
  });

  it('400 STATUS_NOT_FOUND(요청 전에 이미 삭제된 상태)도 상태 목록만 다시 받는다', async () => {
    expect(await invalidatedKeysAfter(apiError(400, 'STATUS_NOT_FOUND'))).toEqual(['["projectStatuses","WP"]']);
  });

  it('코드 없는 409(버전 충돌)면 이슈 상세·목록을 다시 받고 상태 목록은 그대로 둔다', async () => {
    const keys = await invalidatedKeysAfter(apiError(409));
    expect(keys).not.toContain('["projectStatuses","WP"]');
    expect(keys.length).toBe(2);
  });
});
