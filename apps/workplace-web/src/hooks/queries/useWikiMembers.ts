// 위키 스페이스 멤버 조회 + 멤버 mutation 모음(TEAM 위키 공유).
// 성공 시 멤버 목록(members)·스페이스 목록(spaces, 역할 변경 안전)을 무효화한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { wikiApi } from '../../api/wiki'
import { handleApiError } from '../../lib/api-error'
import type { WikiMember } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

// 멤버 목록 — spaceId 가 있을 때만 조회.
export function useWikiMembers(spaceId: number | null) {
  return useQuery<WikiMember[]>({
    queryKey: wikiKeys.members(spaceId ?? 0),
    queryFn: () => wikiApi.listMembers(spaceId as number).then((r) => r.data),
    enabled: spaceId != null,
  })
}

// 공통 무효화 — 멤버 목록 + 스페이스 목록(내 역할 변동 대비).
function invalidate(qc: ReturnType<typeof useQueryClient>, spaceId: number) {
  qc.invalidateQueries({ queryKey: wikiKeys.members(spaceId) })
  qc.invalidateQueries({ queryKey: wikiKeys.spaces() })
}

// 멤버 추가 — { userId, role }.
export function useAddWikiMember(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, { userId: number; role: string }>({
    mutationFn: ({ userId, role }) =>
      wikiApi.addMember(spaceId, userId, role).then((r) => r.data),
    onSuccess: () => invalidate(qc, spaceId),
    onError: (err) => handleApiError(err, '멤버 추가에 실패했어요'),
  })
}

// 역할 변경 — OWNER 만 가능(서버 권한 검증).
export function useUpdateWikiMemberRole(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, { userId: number; role: string }>({
    mutationFn: ({ userId, role }) =>
      wikiApi.updateMemberRole(spaceId, userId, role).then((r) => r.data),
    onSuccess: () => invalidate(qc, spaceId),
    onError: (err) => handleApiError(err, '역할 변경에 실패했어요'),
  })
}

// 멤버 제거 — OWNER 만 가능.
export function useRemoveWikiMember(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, number>({
    mutationFn: (userId) => wikiApi.removeMember(spaceId, userId).then((r) => r.data),
    onSuccess: () => {
      invalidate(qc, spaceId)
      toast.success('멤버를 제거했어요')
    },
    onError: (err) => handleApiError(err, '멤버 제거에 실패했어요'),
  })
}
