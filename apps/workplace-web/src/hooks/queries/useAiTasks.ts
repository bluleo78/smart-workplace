// AI 위임 작업 목록(cursor 무한 스크롤)·상태별 건수 — 키 루트 'ai-tasks' 는 issue resource.changed 로 무효화된다.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { type AiTaskCounts, fetchAiTaskCounts, fetchAiTasks } from '../../api/aiTasks'
import type { IssueSearchResponse } from '../../types/issue'

export function useAiTasks(params: Record<string, string>, size = 30) {
  return useInfiniteQuery<IssueSearchResponse, Error>({
    queryKey: ['ai-tasks', 'list', params, size],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchAiTasks(params, pageParam as string | null, size),
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function useAiTaskCounts(params: Record<string, string>) {
  return useQuery<AiTaskCounts, Error>({
    queryKey: ['ai-tasks', 'counts', params],
    queryFn: () => fetchAiTaskCounts(params),
  })
}
