// 구성원 디렉터리 조회 훅 (#833).
import { useQuery } from '@tanstack/react-query'

import { membersApi } from '../../api/members'

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
}) {
  return useQuery({
    queryKey: memberKeys.list(params),
    queryFn: () => membersApi.getMembers(params).then(r => r.data),
  })
}
