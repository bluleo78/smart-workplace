// useIssueBoardColumns — 컬럼(statusId)별 관찰자 구독 수명(WP-808 Task 10 리뷰).
// 컬럼을 제외했다 다시 포함하면 그 컬럼 관찰자가 다시 구독되어(커밋된 제외로 버려진 뒤 새로 만들어진 관찰자) 이후 키 변경에도 조회하는지,
// 상태가 늘어도 기존 컬럼은 재조회하지 않는지 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { searchIssues } from '../../api/issues';
import { parseFilters } from '../../lib/issueFilters';
import type { IssueFilters } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';
import { useIssueBoardColumns } from './useIssueBoardColumns';

vi.mock('../../api/issues', () => ({
  searchIssues: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
}));

const st = (id: number): ProjectStatus => ({ id, name: `상태${id}`, category: 'IN_PROGRESS', position: id });
const BASE = parseFilters(new URLSearchParams());

// 컬럼별 조회 횟수 — 조회 필터의 statusIds 한 개(컬럼 id)와 검색어로 센다.
function callsFor(id: number, q = '') {
  return vi.mocked(searchIssues).mock.calls.filter(([, f]) => f.statusIds[0] === id && f.q === q).length;
}

describe('useIssueBoardColumns', () => {
  let client: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;
  beforeEach(() => {
    vi.mocked(searchIssues).mockClear();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  });
  afterEach(() => client.clear());

  it('statusIds 필터로 뺀 컬럼은 조회하지 않고, 되돌리면 새 관찰자가 구독되어 이후 키 변경에도 조회한다', async () => {
    const statuses = [st(1), st(2)];
    const { result, rerender } = renderHook((f: IssueFilters) => useIssueBoardColumns('WP', f, statuses), {
      wrapper,
      initialProps: BASE,
    });
    await waitFor(() => expect(result.current[2]?.isSuccess).toBe(true));
    expect(callsFor(1)).toBe(1);
    expect(callsFor(2)).toBe(1);

    // 컬럼 2 제외 — 결과가 없고 조회도 없다.
    rerender({ ...BASE, statusIds: [1] });
    expect(result.current[2]).toBeUndefined();
    // 다시 포함 — 제외가 커밋되며 컬럼 2 관찰자는 구독 해제·폐기됐다. 새로 만든 관찰자가 다시 구독되는지가 핵심이다(같은 키라 캐시로 바로 보인다).
    rerender(BASE);
    await waitFor(() => expect(result.current[2]?.isSuccess).toBe(true));
    // 다른 필터로 키가 바뀌면 두 컬럼 모두 새로 조회한다 — 구독되지 않은 관찰자면 컬럼 2 는 조회하지 않고 멈춘다.
    rerender({ ...BASE, q: '검색' });
    await waitFor(() => expect(callsFor(2, '검색')).toBe(1));
    expect(callsFor(1, '검색')).toBe(1);
    await waitFor(() => expect(result.current[2]?.isSuccess).toBe(true));
  });

  it('상태가 늘면 새 컬럼만 조회하고 기존 컬럼은 다시 조회하지 않는다', async () => {
    const { result, rerender } = renderHook((s: ProjectStatus[]) => useIssueBoardColumns('WP', BASE, s), {
      wrapper,
      initialProps: [st(1), st(2)],
    });
    await waitFor(() => expect(result.current[2]?.isSuccess).toBe(true));

    rerender([st(1), st(2), st(3)]);
    await waitFor(() => expect(result.current[3]?.isSuccess).toBe(true));
    expect(callsFor(3)).toBe(1);
    // staleTime 0 이라 재구독되면 바로 재조회된다 — 관찰자 단위 구독이면 기존 컬럼은 그대로 1회.
    expect(callsFor(1)).toBe(1);
    expect(callsFor(2)).toBe(1);
  });
});
