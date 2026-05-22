// 이슈 검색/필터 — cursor 기반 무한 스크롤.
// list 뷰와 board 뷰가 동일한 쿼리 키를 공유해 캐시를 재사용한다.

import { useInfiniteQuery } from '@tanstack/react-query';

import { searchIssues } from '../../api/issues';
import type { IssueFilters, IssueSearchResponse } from '../../types/issue';

// queryKey 는 ['issues', 'search', projectKey, filters, size] — URL 이 바뀌면 자동으로 재실행된다.
// pageParam 은 nextCursor 문자열(또는 null) 이며 백엔드가 base64url 로 인코딩한 불투명 토큰이다.
export function useIssueSearch(projectKey: string, filters: IssueFilters, size = 30) {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    queryKey: ['issues', 'search', projectKey, filters, size],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      searchIssues(projectKey, filters, pageParam as string | null, size),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!projectKey,
  });
}
