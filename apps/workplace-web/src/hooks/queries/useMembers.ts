// 구성원 디렉터리 조회 훅 (#833).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { membersApi } from '../../api/members'
import { nextOffsetPage } from '../../lib/offsetPaging'

export const memberKeys = {
  list: (params: Record<string, unknown>) => ['members', params] as const,
  /** 이어 받기 목록 키 — 설정 > 구성원 목록(WP-182). */
  infinite: (params: Record<string, unknown>, size: number) => ['members', 'infinite', params, size] as const,
  /**
   * 고르기 창(PeopleAndDepartmentPicker) 전용 이어 받기 키의 접두(WP-1225) — 창이 닫힐 때 이 접두의 캐시만 첫 페이지로 줄인다.
   * 설정 > 구성원 목록(infinite)과 키를 갈라 두어, 창을 닫아도 그 목록이 받아 둔 페이지는 건드리지 않는다.
   * 'members' 접두는 유지해 구성원 변경 무효화는 함께 받는다.
   */
  pickerInfinite: ['members', 'picker-infinite'] as const,
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
  options?: { enabled?: boolean; scope?: 'picker' },
) {
  return useInfiniteQuery({
    // scope 'picker' 는 고르기 창 전용 키 — 닫을 때 접두로 한꺼번에 줄이려고 목록 화면 캐시와 가른다(WP-1225).
    queryKey: options?.scope === 'picker' ? [...memberKeys.pickerInfinite, params, size] : memberKeys.infinite(params, size),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => membersApi.getMembers({ ...params, page: pageParam, size }).then(r => r.data),
    getNextPageParam: nextOffsetPage,
    // 고르기 창처럼 닫혀도 마운트된 채 남는 곳은 열렸을 때만 받는다(WP-1225 — 닫힌 창이 포커스·stale 마다 받아 둔 모든 페이지를 다시 받지 않게).
    enabled: options?.enabled,
  })
}
