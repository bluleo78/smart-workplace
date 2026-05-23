// 내가 구독 중인 이슈 — cursor 페이지네이션 무한 스크롤.

import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchWatchedIssues } from '../../api/watchers';
import type { IssueSearchResponse } from '../../types/issue';

export function useWatchedIssues(size = 30) {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    queryKey: ['watched-issues', size],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchWatchedIssues(pageParam as string | null, size),
    getNextPageParam: (last) => last.nextCursor,
  });
}
