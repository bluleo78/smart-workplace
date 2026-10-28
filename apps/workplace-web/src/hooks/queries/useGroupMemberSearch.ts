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

/**
 * 그룹과 하위 조직의 구성원 전체(WP-1048) — 노트 공유 창에서 지정한 부서의 지금 구성원을 펼쳐 볼 때. 펼칠 때만 받는다(enabled).
 * 검색과 같은 엔드포인트에 빈 검색어 — 서버가 하위 조직까지 모아 한 사람은 한 번만(가장 가까운 소속) 준다.
 */
export function useGroupAllMembers(groupId: number, enabled = true) {
  return useQuery({ ...groupAllMembersQuery(groupId), enabled })
}

/**
 * 그룹과 하위 조직의 구성원 전체 조회 옵션 — useGroupAllMembers·고르기 창의 부서 펼침·일정 참석자의 그룹 풀어 넣기(WP-1059)가 같은 캐시를
 * 쓰도록 한 곳에 둔다(키·조회·신선도가 하나라도 다르면 캐시가 말없이 갈린다).
 */
export function groupAllMembersQuery(groupId: number) {
  return {
    queryKey: userGroupKeys.memberSearch(groupId, ''),
    queryFn: (): Promise<UserGroupMemberHit[]> => userGroupsApi.searchMembers(groupId, '').then((r) => r.data),
    staleTime: 10_000,
  }
}
