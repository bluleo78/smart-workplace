// 프로젝트 상태 캐시 규칙(WP-808) — 모르는 statusId 를 만나면 상태 목록을 한 번만 다시 받고(refreshStatusesOnUnknown),
// 이름·색을 바꾸면 이슈 캐시의 상태 이름·색을 제자리로 고친다(useUpdateProjectStatus).
// 순서 변경은 낙관적으로 목록을 바꾸고 실패하면 되돌린다, 삭제는 상태·이슈·저장된 뷰를 다시 받는다(WP-809).
import { type InfiniteData, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { IssueDetailResponse, IssueResponse, IssueSearchResponse } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';

vi.mock('../../api/projectStatuses', () => ({
  listProjectStatuses: vi.fn(),
  createProjectStatus: vi.fn(),
  updateProjectStatus: async (_pk: string, id: number, body: { name?: string; color?: string }) => ({
    ...SEED[1],
    id,
    name: body.name ?? SEED[1].name,
    color: body.color ?? 'BLUE',
  }),
  reorderProjectStatuses: vi.fn(),
  deleteProjectStatus: vi.fn(async () => undefined),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { toast } from 'sonner';

import { listProjectStatuses, reorderProjectStatuses } from '../../api/projectStatuses';
import {
  applyCategoryOrder,
  refreshStatusesOnUnknown,
  unknownStatusIds,
  useDeleteProjectStatus,
  useProjectStatuses,
  useReorderProjectStatuses,
  useUpdateProjectStatus,
} from './useProjectStatuses';

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

describe('useUpdateProjectStatus', () => {
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

    const { result } = renderHook(() => useUpdateProjectStatus('WP'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 2, body: { name: '작업 중' } }));

    expect(qc.getQueryData<ProjectStatus[]>(['projectStatuses', 'WP'])!.map((s) => s.name)).toEqual(['할 일', '작업 중']);
    const items = qc.getQueryData<InfiniteData<IssueSearchResponse>>(searchKey)!.pages[0].items;
    expect(items.map((it) => it.statusName)).toEqual(['작업 중', '할 일']);
    expect(qc.getQueryData<IssueDetailResponse>(detailKey)!.summary.statusName).toBe('작업 중');
    // 교차 프로젝트 이슈 목록은 SSE project-status 규칙이 맞춘다 — 여기서는 아무것도 무효화하지 않는다
    expect(spy).not.toHaveBeenCalled();
  });

  it('색을 바꾸면 목록과 그 상태 이슈의 statusColor 를 제자리로 고친다', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const searchKey = ['issues', 'search', 'WP', {}, 50];
    qc.setQueryData(['projectStatuses', 'WP'], SEED);
    qc.setQueryData<InfiniteData<IssueSearchResponse>>(searchKey, {
      pages: [{ items: [{ number: 7, status: 'IN_PROGRESS', statusId: 2, statusName: '진행 중' } as IssueResponse], nextCursor: null, hasMore: false }],
      pageParams: [null],
    });
    const { result } = renderHook(() => useUpdateProjectStatus('WP'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 2, body: { color: 'PURPLE' } }));
    expect(qc.getQueryData<ProjectStatus[]>(['projectStatuses', 'WP'])![1].color).toBe('PURPLE');
    expect(qc.getQueryData<InfiniteData<IssueSearchResponse>>(searchKey)!.pages[0].items[0].statusColor).toBe('PURPLE');
  });
});

// 진행 중 범주에 셋 — 진행 중(2)·검토 중(12)·QA(13), 앞뒤로 할 일·완료.
const ORDERED: ProjectStatus[] = [
  { id: 1, name: '할 일', category: 'TODO', position: 0 },
  { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
  { id: 12, name: '검토 중', category: 'IN_PROGRESS', position: 2 },
  { id: 13, name: 'QA', category: 'IN_PROGRESS', position: 3 },
  { id: 3, name: '완료', category: 'DONE', position: 4 },
];

describe('applyCategoryOrder', () => {
  it('그 범주만 새 순서로 두고 기존 position 을 오름차순으로 다시 나눈다', () => {
    const next = applyCategoryOrder(ORDERED, 'IN_PROGRESS', [13, 2, 12]);
    expect(next.map((s) => [s.id, s.position])).toEqual([[1, 0], [13, 1], [2, 2], [12, 3], [3, 4]]);
  });

  it('범주 전체가 아닌 id 목록이면 그대로', () => {
    expect(applyCategoryOrder(ORDERED, 'IN_PROGRESS', [13, 2]).map((s) => s.id)).toEqual([1, 2, 12, 13, 3]);
  });
});

describe('useReorderProjectStatuses', () => {
  it('보내는 즉시 목록을 새 순서로 두고, 실패하면 되돌리며 토스트로 알린다', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    qc.setQueryData(['projectStatuses', 'WP'], ORDERED);
    let reject!: (e: Error) => void;
    vi.mocked(reorderProjectStatuses).mockImplementationOnce(() => new Promise((_res, rej) => (reject = rej)));
    vi.mocked(listProjectStatuses).mockResolvedValue(ORDERED);

    const { result } = renderHook(() => useReorderProjectStatuses('WP'), { wrapper });
    act(() => result.current.mutate({ category: 'IN_PROGRESS', statusIds: [13, 2, 12] }));
    await waitFor(() =>
      expect(qc.getQueryData<ProjectStatus[]>(['projectStatuses', 'WP'])!.map((s) => s.id)).toEqual([1, 13, 2, 12, 3]),
    );

    await act(async () => reject(new Error('500')));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('순서를 바꾸지 못했어요'));
    expect(qc.getQueryData<ProjectStatus[]>(['projectStatuses', 'WP'])!.map((s) => s.id)).toEqual([1, 2, 12, 13, 3]);
  });
});

describe('useDeleteProjectStatus', () => {
  // 고정된 뷰(사이드바)도 저장된 뷰 쿼리를 싣는다 — 상태 필터가 서버에서 치환·제거되므로 함께 다시 받는다(resourceInvalidation op=deleted 와 같다).
  it('성공하면 상태 목록·이슈 검색·상세·저장된 뷰·고정된 뷰를 다시 받는다', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const spy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteProjectStatus('WP'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 12, moveTo: 2 }));
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)).toEqual([
      ['projectStatuses', 'WP'],
      ['issues', 'search', 'WP'],
      ['issues', 'WP'],
      ['savedViews', 'WP'],
      ['pinnedViews'],
    ]);
  });

  // 삭제 창은 mutateAsync 가 끝나야 닫힌다 — 이슈 검색 재조회가 오래 걸려도 상태 목록만 받으면 끝나야 한다.
  it('이슈 검색 재조회를 기다리지 않고 끝난다', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    // 켜져 있는 이슈 검색 쿼리 — 첫 조회 뒤 재조회는 끝나지 않는다.
    let calls = 0;
    const search = renderHook(
      () => useQuery({ queryKey: ['issues', 'search', 'WP', 'x'], queryFn: () => (calls++ === 0 ? Promise.resolve(1) : new Promise<number>(() => {})) }),
      { wrapper },
    );
    await waitFor(() => expect(search.result.current.data).toBe(1));
    const { result } = renderHook(() => useDeleteProjectStatus('WP'), { wrapper });
    await act(() => result.current.mutateAsync({ id: 12, moveTo: 2 }));
    expect(calls).toBe(2);
  });
});
