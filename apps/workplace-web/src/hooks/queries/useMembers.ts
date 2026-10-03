// 구성원 디렉터리 조회 훅 (#833).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { membersApi } from '../../api/members'
import { nextOffsetPage } from '../../lib/offsetPaging'

export const memberKeys = {
  list: (params: Record<string, unknown>) => ['members', params] as const,
}

/** 구성원 목록 — 설정 > 구성원 화면, 감사 로그의 id→이름 조회 등. */
export function useMembers(params: {
  search?: string
  kind?: 'HUMAN' | 'AGENT' | 'ALL'
  includeInactive?: boolean
  page?: number
  size?: number
}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: memberKeys.list(params),
    queryFn: () => membersApi.getMembers(params).then(r => r.data),
    enabled: options?.enabled,
  })
}

/**
 * 구성원 목록 무한 스크롤 (WP-182) — 설정 > 구성원 화면.
 * 키에 'infinite' 를 넣어 useMembers(단일 PageResponse) 캐시와 모양이 섞이지 않게 하되,
 * 'members' 접두는 유지해 구성원 추가·변경 시 invalidateQueries(['members']) 가 함께 무효화한다.
 */
export function useInfiniteMembers(
  params: { search?: string; kind?: 'HUMAN' | 'AGENT' | 'ALL'; includeInactive?: boolean },
  size = 50,
) {
  return useInfiniteQuery({
    queryKey: ['members', 'infinite', params, size] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => membersApi.getMembers({ ...params, page: pageParam, size }).then(r => r.data),
    getNextPageParam: nextOffsetPage,
  })
}
