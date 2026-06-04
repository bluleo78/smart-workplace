import { useQuery } from '@tanstack/react-query'

import { userGroupsApi } from '../../api/userGroups'
import type { UserGroupDetail } from '../../types/userGroup'
import { userGroupKeys } from './userGroupKeys'

/** 그룹 상세(직속 멤버 포함). id=null 이면 비활성. */
export function useUserGroupDetail(id: number | null) {
  return useQuery<UserGroupDetail>({
    queryKey: id ? userGroupKeys.detail(id) : ['user-groups', 'detail', 'idle'],
    enabled: id != null,
    queryFn: () => userGroupsApi.detail(id!).then((r) => r.data),
    staleTime: 10_000,
  })
}
