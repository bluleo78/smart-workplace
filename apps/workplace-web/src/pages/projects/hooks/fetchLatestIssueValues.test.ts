import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { fetchLatestIssueValues } from './fetchLatestIssueValues';

let detail: unknown;
vi.mock('@/hooks/queries/useIssue', () => ({
  issueDetailQuery: () => ({ queryKey: ['issue-detail-test'], queryFn: async () => detail }),
}));

// 최신 상세를 받아 판정 재료로 바꾼다 — version 이 없으면 0 으로 메우지 않고 실패로 던진다(WP-2095).
describe('fetchLatestIssueValues', () => {
  it('version·제목·본문을 돌려준다', async () => {
    detail = { summary: { title: '제목', version: 4 }, body: '본문' };
    const r = await fetchLatestIssueValues(new QueryClient(), 'WP', 1);
    expect(r).toEqual({ version: 4, values: { title: '제목', body: '본문' } });
  });
  it('version 이 없으면 0 으로 메우지 않고 던진다', async () => {
    detail = { summary: { title: '제목' }, body: '본문' };
    await expect(fetchLatestIssueValues(new QueryClient(), 'WP', 1)).rejects.toThrow();
  });
});
