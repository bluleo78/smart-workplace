import { useQuery } from '@tanstack/react-query'
import { userGroupsApi } from '../../api/userGroups'
import type { UserGroupTree } from '../../types/userGroup'
import { userGroupKeys } from './userGroupKeys'

/** 공유 조직도 + 내 개인 그룹 트리 조회. */
export function useUserGroups() {
  return useQuery<UserGroupTree>({
    queryKey: userGroupKeys.tree,
    queryFn: () => userGroupsApi.tree().then((r) => r.data),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
}
