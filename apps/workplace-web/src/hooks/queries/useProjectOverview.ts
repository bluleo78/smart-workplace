// 프로젝트 「개요」 탭(WP-1478) 조회 훅.
import { useQuery } from '@tanstack/react-query'

import { fetchProjectOverview } from '../../api/projectOverview'

/** 쿼리 키 — 이슈를 바꾸는 쓰기가 개요를 다시 부르게 할 때 이 키를 쓴다. */
export const projectOverviewKey = (projectKey: string) => ['projectOverview', projectKey] as const

/**
 * 개요 한 화면. retry:false — 실패를 곧장 다시 시도 안내로 보인다(내 작업 개요와 같은 방침).
 * staleTime 0 — 앱 전역 기본(30초)을 덮어, 탭을 오갈 때마다(들를 때마다) 새로 불러 숫자가 바뀌어 있게 한다.
 */
export function useProjectOverview(projectKey: string) {
  return useQuery({
    queryKey: projectOverviewKey(projectKey),
    queryFn: () => fetchProjectOverview(projectKey),
    enabled: !!projectKey,
    retry: false,
    staleTime: 0,
  })
}
