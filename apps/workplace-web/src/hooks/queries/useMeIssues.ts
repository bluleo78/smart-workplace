// 프로젝트 횡단 "내 이슈"(할당/내가 만든 등) — params 필터, cursor 무한 스크롤.
import { useInfiniteQuery } from '@tanstack/react-query'

import { fetchMeIssues } from '../../api/meIssues'
import type { IssueSearchResponse } from '../../types/issue'

export function useMeIssues(params: Record<string, string>, size = 30) {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    // params 를 key 에 포함 — 탭(assignee/reporter)마다 캐시 분리.
    queryKey: ['me-issues', params, size],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchMeIssues(params, pageParam as string | null, size),
    getNextPageParam: (last) => last.nextCursor,
  })
}
