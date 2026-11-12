// 개요 카드 리포트 줄(WP-1483) 조회 훅.
import { useQuery } from '@tanstack/react-query'

import { fetchProjectReports } from '../../api/projectReports'

/** 쿼리 키. */
export const projectReportsKey = (projectKey: string) => ['projectReports', projectKey] as const

/**
 * 리포트 줄 — 개요와 같이 들를 때마다 새로 부른다(staleTime 0: 사람이 노트에서 고친 한 줄이 바로 보이게).
 * retry:false — 실패하면 줄을 그리지 않을 뿐 개요 전체를 막지 않는다.
 */
export function useProjectReports(projectKey: string) {
  return useQuery({
    queryKey: projectReportsKey(projectKey),
    queryFn: () => fetchProjectReports(projectKey),
    enabled: !!projectKey,
    retry: false,
    staleTime: 0,
  })
}
