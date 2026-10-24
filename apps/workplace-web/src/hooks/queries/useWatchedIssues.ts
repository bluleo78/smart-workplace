// 내가 구독 중인 이슈 — cursor 페이지네이션 무한 스크롤.

import { useInfiniteQuery } from '@tanstack/react-query';

import { fetchWatchedIssues } from '../../api/watchers';
import type { IssueSearchResponse } from '../../types/issue';

// group — 'recent' 면 프로젝트 묶음 순서(WP-915). 접두 'watched-issues' 를 유지해 useWatchToggle 의 무효화가 닿게 한다.
export function useWatchedIssues(size = 30, group?: 'recent') {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    queryKey: ['watched-issues', size, group ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchWatchedIssues(pageParam as string | null, size, group),
    getNextPageParam: (last) => last.nextCursor,
  });
}
