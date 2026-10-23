// 프로젝트 상태 캐시 규칙(WP-808) — 모르는 statusId 를 만나면 상태 목록을 한 번만 다시 받고(refreshStatusesOnUnknown),
// 이름을 바꾸면 이슈 캐시의 상태 이름을 제자리로 고친다(useRenameProjectStatus).
import { type InfiniteData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { IssueDetailResponse, IssueResponse, IssueSearchResponse } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';

vi.mock('../../api/projectStatuses', () => ({
  listProjectStatuses: vi.fn(),
  createProjectStatus: vi.fn(),
  renameProjectStatus: async (_pk: string, id: number, body: { name: string }) => ({ ...SEED[1], id, name: body.name }),
}));

import { listProjectStatuses } from '../../api/projectStatuses';
import { refreshStatusesOnUnknown, unknownStatusIds, useProjectStatuses, useRenameProjectStatus } from './useProjectStatuses';

const SEED: ProjectStatus[] = [
  { id: 1, name: '할 일', category: 'TODO', position: 0 },
  { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
];

// 상태 목록 무효화 호출 수 — 재조회 여부는 무효화로 판정한다.
function statusInvalidations(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((args) => JSON.stringify((args[0] as { queryKey?: unknown } | undefined)?.queryKey) === '["projectStatuses","WP"]')
    .length;
}

describe('unknownStatusIds', () => {
  it('목록에 없는 statusId 만 중복 없이 돌려준다', () => {
    expect(unknownStatusIds([{ statusId: 1 }, { statusId: 9 }, { statusId: 9 }, { statusId: null }], SEED)).toEqual([9]);
  });
});

describe('refreshStatusesOnUnknown', () => {
  it('모르는 상태를 만나면 상태 목록을 한 번 무효화하고, 같은 id 는 반복하지 않는다', () => {
    const qc = new QueryClient();
    qc.setQueryData(['projectStatuses', 'WP'], SEED);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    refreshStatusesOnUnknown(qc, 'WP', [{ statusId: 1 }, { statusId: 9 }]);
    refreshStatusesOnUnknown(qc, 'WP', [{ statusId: 9 }, { statusId: 1 }]);
    expect(statusInvalidations(spy)).toBe(1);
  });

  it('모르는 상태가 없으면 무효화하지 않는다', () => {
    const qc = new QueryClient();
    qc.setQueryData(['projectStatuses', 'WP'], SEED);
    const spy = vi.spyOn(qc, 'invalidateQueries');
    refreshStatusesOnUnknown(qc, 'WP', [{ statusId: 2 }]);
    expect(statusInvalidations(spy)).toBe(0);
  });

  it('같은 상태 목록 배열을 쓰는 다른 QueryClient 의 기록과 섞이지 않는다', () => {
    const a = new QueryClient();
    const b = new QueryClient();
    a.setQueryData(['projectStatuses', 'WP'], SEED);
    b.setQueryData(['projectStatuses', 'WP'], SEED);
    const spyB = vi.spyOn(b, 'invalidateQueries');
    refreshStatusesOnUnknown(a, 'WP', [{ statusId: 9 }]);
    refreshStatusesOnUnknown(b, 'WP', [{ statusId: 9 }]);
    expect(statusInvalidations(spyB)).toBe(1);
  });

  it('상태 목록이 아직 캐시에 없으면(로딩 중·실패) 판정하지 않는다', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    refreshStatusesOnUnknown(qc, 'WP', [{ statusId: 9 }]);
    expect(statusInvalidations(spy)).toBe(0);
  });
});

// 상태 목록 조회 훅을 띄운다 — 목록이 도착할 때 캐시된 검색 페이지를 검사하는지 본다.
function mountStatuses(qc: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useProjectStatuses('WP'), { wrapper });
}

// 모르는 상태(9)를 가진 이슈 검색 페이지가 이미 캐시에 있는 클라이언트.
function clientWithUnknownIssue() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData<InfiniteData<IssueSearchResponse>>(['issues', 'search', 'WP', {}, 50], {
    pages: [{ items: [{ number: 7, statusId: 9 } as IssueResponse], nextCursor: null, hasMore: false }],
    pageParams: [null],
  });
  return qc;
}

describe('상태 목록이 이슈 검색보다 늦게 도착할 때', () => {
  it('목록이 도착하면 캐시된 검색 페이지를 검사해 모르는 상태로 한 번만 다시 받는다', async () => {
    const list = vi.mocked(listProjectStatuses);
    list.mockReset();
    // 다시 받아도 같은 내용(9 는 여전히 없음) — 반복 재조회하지 않아야 한다
    list.mockImplementation(async () => SEED.map((s) => ({ ...s })));
    const qc = clientWithUnknownIssue();
    mountStatuses(qc);

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('상태 목록을 쓰는 소비자가 여럿이어도 같은 목록으로는 검색 캐시를 한 번만 훑는다', async () => {
    const list = vi.mocked(listProjectStatuses);
    list.mockReset();
    list.mockImplementation(async () => SEED.map((s) => ({ ...s })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const scan = vi.spyOn(qc, 'getQueriesData');
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => [useProjectStatuses('WP'), useProjectStatuses('WP'), useProjectStatuses('WP')], { wrapper });
    await waitFor(() => expect(result.current[0].data).toBeDefined());
    const searchScans = scan.mock.calls.filter((args) => JSON.stringify((args[0] as { queryKey?: unknown }).queryKey) === '["issues","search","WP"]');
    expect(searchScans).toHaveLength(1);
  });

  it('다시 받아도 없으면 멈추되, 목록 내용이 바뀌어 새로 받아지면 다시 물을 수 있다', async () => {
    const list = vi.mocked(listProjectStatuses);
    list.mockReset();
    list.mockImplementation(async () => SEED.map((s) => ({ ...s })));
    const qc = clientWithUnknownIssue();
    mountStatuses(qc);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    // 다른 사용자가 상태를 하나 더 만들어(SSE 무효화) 목록이 바뀐다 — 9 는 여전히 없다
    list.mockImplementation(async () => [...SEED, { id: 3, name: '검토', category: 'IN_PROGRESS', position: 2 }]);
    await act(() => qc.invalidateQueries({ queryKey: ['projectStatuses', 'WP'] }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(4));
    await new Promise((r) => setTimeout(r, 50));
    expect(list).toHaveBeenCalledTimes(4);
  });
});

describe('useRenameProjectStatus', () => {
  it('상태 목록·검색·상세 캐시의 이름을 제자리로 고치고 다시 받지 않는다', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const searchKey = ['issues', 'search', 'WP', {}, 50];
    const detailKey = ['issues', 'WP', 'detail', 7];
    const issue = (number: number, statusId: number, statusName: string) =>
      ({ number, status: 'IN_PROGRESS', statusId, statusName }) as IssueResponse;
    qc.setQueryData(['projectStatuses', 'WP'], SEED);
    qc.setQueryData<InfiniteData<IssueSearchResponse>>(searchKey, {
      pages: [{ items: [issue(7, 2, '진행 중'), issue(8, 1, '할 일')], nextCursor: null, hasMore: false }],
      pageParams: [null],
    });
    qc.setQueryData(detailKey, { summary: issue(7, 2, '진행 중') } as IssueDetailResponse);
    const spy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useRenameProjectStatus('WP'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 2, body: { name: '작업 중' } }));

    expect(qc.getQueryData<ProjectStatus[]>(['projectStatuses', 'WP'])!.map((s) => s.name)).toEqual(['할 일', '작업 중']);
    const items = qc.getQueryData<InfiniteData<IssueSearchResponse>>(searchKey)!.pages[0].items;
    expect(items.map((it) => it.statusName)).toEqual(['작업 중', '할 일']);
    expect(qc.getQueryData<IssueDetailResponse>(detailKey)!.summary.statusName).toBe('작업 중');
    // 교차 프로젝트 이슈 목록은 SSE project-status 규칙이 맞춘다 — 여기서는 아무것도 무효화하지 않는다
    expect(spy).not.toHaveBeenCalled();
  });
});
