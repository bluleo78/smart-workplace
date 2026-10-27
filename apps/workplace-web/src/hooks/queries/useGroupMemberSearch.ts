import { useQuery } from '@tanstack/react-query'

import { userGroupsApi } from '../../api/userGroups'
import type { UserGroupMemberHit } from '../../types/userGroup'
import { userGroupKeys } from './userGroupKeys'

/**
 * 그룹과 하위 조직에서 구성원 찾기(WP-1000) — 연락처 조직도 그룹 보기의 검색. 검색어가 비면 끈다(그때는 그룹 상세의 직속 멤버를 보인다).
 * 검색어가 바뀌는 동안 앞 결과를 남겨 목록이 「불러오는 중」으로 깜빡이지 않게 한다.
 */
export function useGroupMemberSearch(groupId: number, q: string) {
  const query = q.trim()
  return useQuery<UserGroupMemberHit[]>({
    queryKey: userGroupKeys.memberSearch(groupId, query),
    queryFn: () => userGroupsApi.searchMembers(groupId, query).then((r) => r.data),
    enabled: query !== '',
    // 같은 그룹 안에서만 앞 결과를 남긴다 — 다른 그룹으로 옮기면 앞 그룹 결과(다른 소속 경로)를 잠깐이라도 보이지 않게.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === groupId ? prev : undefined),
    staleTime: 10_000,
  })
}
