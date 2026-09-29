import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { handleResourceEvent } from './useResourceStream';

describe('handleResourceEvent', () => {
  it('issue 변경 → 배처를 거쳐 프로젝트 검색 키 무효화', async () => {
    vi.useFakeTimers();
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    handleResourceEvent(qc, { resource: 'issue', op: 'deleted', projectKey: 'EX', issueNumber: 3 });
    vi.advanceTimersByTime(150);
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['issues', 'search', 'EX'], exact: false });
    vi.useRealTimers();
  });

  it('비정상 payload 는 무시', () => {
    const qc = { invalidateQueries: vi.fn() } as unknown as QueryClient;
    expect(() => handleResourceEvent(qc, undefined)).not.toThrow();
  });
});
