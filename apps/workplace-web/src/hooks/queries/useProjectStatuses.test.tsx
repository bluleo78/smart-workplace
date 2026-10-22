// useRefreshStatusesOnUnknown — 상태 목록에 없는 statusId 를 만나면 상태 목록을 한 번만 다시 받는다(WP-808).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectStatus } from '../../types/projectStatus';

// 상태 목록 API 대역 — 호출 수를 세고 fail 이면 거절한다. vi.fn 에 거절 구현을 주면 react-query 가 처리해도 테스트가 실패로 보고돼 직접 센다.
const api = { calls: 0, fail: false };
vi.mock('../../api/projectStatuses', () => ({
  listProjectStatuses: async () => {
    api.calls++;
    if (api.fail) throw new Error('목록 실패(테스트)');
    return SEED;
  },
  createProjectStatus: vi.fn(),
  renameProjectStatus: vi.fn(),
}));

import { unknownStatusIds, useRefreshStatusesOnUnknown } from './useProjectStatuses';

const SEED: ProjectStatus[] = [
  { id: 1, name: '할 일', category: 'TODO', position: 0 },
  { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1 },
];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

beforeEach(() => {
  api.calls = 0;
  api.fail = false;
});

describe('unknownStatusIds', () => {
  it('목록에 없는 statusId 만 중복 없이 돌려준다', () => {
    expect(unknownStatusIds([{ statusId: 1 }, { statusId: 9 }, { statusId: 9 }, { statusId: null }], SEED)).toEqual([9]);
  });
});

describe('useRefreshStatusesOnUnknown', () => {
  it('모르는 상태를 만나면 상태 목록을 한 번 다시 받고, 다시 받아도 없으면 반복하지 않는다', async () => {
    const { wrapper } = setup();
    const { rerender } = renderHook(({ issues }) => useRefreshStatusesOnUnknown('WP', issues), {
      wrapper,
      initialProps: { issues: [{ statusId: 1 }, { statusId: 9 }] },
    });
    await waitFor(() => expect(api.calls).toBe(2));
    rerender({ issues: [{ statusId: 9 }, { statusId: 1 }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls).toBe(2);
  });

  it('모르는 상태가 없으면 다시 받지 않는다', async () => {
    const { wrapper } = setup();
    renderHook(() => useRefreshStatusesOnUnknown('WP', [{ statusId: 2 }]), { wrapper });
    await waitFor(() => expect(api.calls).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls).toBe(1);
  });

  it('상태 목록을 못 받으면(실패) 모든 id 가 모르는 것으로 보여도 재조회하지 않는다', async () => {
    api.fail = true;
    const { qc, wrapper } = setup();
    renderHook(() => useRefreshStatusesOnUnknown('WP', [{ statusId: 9 }]), { wrapper });
    await waitFor(() => expect(qc.getQueryState(['projectStatuses', 'WP'])?.status).toBe('error'));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls).toBe(1);
  });
});
