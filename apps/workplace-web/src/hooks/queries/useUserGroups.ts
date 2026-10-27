import { useQuery } from '@tanstack/react-query'

import { userGroupsApi } from '../../api/userGroups'
import type { UserGroupTree } from '../../types/userGroup'
import { userGroupKeys } from './userGroupKeys'

/**
 * 공유 조직도 + 내 개인 그룹 트리 조회.
 * enabled — 필요할 때만 받는다(노트 공유 창의 사람·팀 검색은 검색창을 열 때, WP-1023). 기본은 바로 받는다.
 */
export function useUserGroups(enabled = true) {
  return useQuery<UserGroupTree>({
    queryKey: userGroupKeys.tree,
    queryFn: () => userGroupsApi.tree().then((r) => r.data),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
