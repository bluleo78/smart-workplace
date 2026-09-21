// 구성원 디렉터리 API (#833) — 계정 관리 API(api/users.ts, ADMIN 전용)와 의도적으로 분리.
import type { PageResponse } from '../types/common'
import type { MemberSummary } from '../types/member'
import { client } from './client'

export const membersApi = {
  /** 구성원 목록/검색. 기본은 활성 구성원만이며 includeInactive 로 비활성까지 포함한다. */
  getMembers: (params: {
    search?: string
    kind?: 'HUMAN' | 'AGENT' | 'ALL'
    includeInactive?: boolean
    page?: number
    size?: number
  }) => client.get<PageResponse<MemberSummary>>('/members', { params }),
  getMember: (userId: number) => client.get<MemberSummary>(`/members/${userId}`),
}
