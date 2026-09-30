// findIssueInSearchCache — 검색 캐시(여러 쿼리·페이지)에서 이슈 현재값을 찾는 리더 검증.
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { findIssueInSearchCache } from './issueSearchCache';

const page = (numbers: number[], parentNumber?: number) => ({
  pages: [{ items: numbers.map((n) => ({ number: n, parent: parentNumber ? { number: parentNumber } : null })) }],
  pageParams: [],
});

describe('findIssueInSearchCache', () => {
  it('다른 쿼리·페이지에 있는 이슈를 찾는다', () => {
    const qc = new QueryClient();
    qc.setQueryData(['issues', 'search', 'WP', 'a'], page([1, 2]));
    qc.setQueryData(['issues', 'search', 'WP', 'b'], page([3], 11));
    expect(findIssueInSearchCache(qc, 'WP', 3)?.parent?.number).toBe(11);
  });
  it('없거나 다른 프로젝트 캐시면 undefined', () => {
    const qc = new QueryClient();
    qc.setQueryData(['issues', 'search', 'XX', 'a'], page([1]));
    expect(findIssueInSearchCache(qc, 'WP', 1)).toBeUndefined();
  });
});
