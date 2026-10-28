// 위키 스페이스 멤버 조회 + 멤버 mutation 모음(TEAM 위키 공유).
// 성공 시 멤버 목록(members)·스페이스 목록(spaces, 역할 변경 안전)을 무효화한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { wikiApi } from '../../api/wiki'
import { handleApiError } from '../../lib/api-error'
import type { WikiMember, WikiMemberGroup } from '../../types/wiki'
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
    onError: (err) => handleApiError(err, '멤버 추가에 실패했습니다'),
  })
}

// 역할 변경 — OWNER 만 가능(서버 권한 검증).
export function useUpdateWikiMemberRole(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, { userId: number; role: string }>({
    mutationFn: ({ userId, role }) =>
      wikiApi.updateMemberRole(spaceId, userId, role).then((r) => r.data),
    onSuccess: () => invalidate(qc, spaceId),
    onError: (err) => handleApiError(err, '역할 변경에 실패했습니다'),
  })
}

// 멤버 제거 — OWNER 만 가능.
export function useRemoveWikiMember(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, number>({
    mutationFn: (userId) => wikiApi.removeMember(spaceId, userId).then((r) => r.data),
    onSuccess: () => {
      invalidate(qc, spaceId)
      toast.success('멤버를 제거했습니다')
    },
    onError: (err) => handleApiError(err, '멤버 제거에 실패했습니다'),
  })
}

// ── 멤버인 조직도 부서(WP-1052) ─────────────────────────────────────────
// 부서 행이 바뀌면 그 부서 사람의 실효 역할(목록의 내 역할 포함)이 바뀔 수 있어 스페이스 목록도 함께 무효화한다.

// 부서 목록 — spaceId 가 있을 때만 조회.
export function useWikiMemberGroups(spaceId: number | null) {
  return useQuery<WikiMemberGroup[]>({
    queryKey: wikiKeys.memberGroups(spaceId ?? 0),
    queryFn: () => wikiApi.listMemberGroups(spaceId as number).then((r) => r.data),
    enabled: spaceId != null,
  })
}

function invalidateGroups(qc: ReturnType<typeof useQueryClient>, spaceId: number) {
  qc.invalidateQueries({ queryKey: wikiKeys.memberGroups(spaceId) })
  qc.invalidateQueries({ queryKey: wikiKeys.spaces() })
  // 사람 행의 「조직으로 …」 안내(부서로 받는 역할, WP-1102)가 부서 역할을 따라 바뀐다.
  qc.invalidateQueries({ queryKey: wikiKeys.members(spaceId) })
}

// 부서 추가 — { groupId, role }.
export function useAddWikiMemberGroup(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<WikiMemberGroup, unknown, { groupId: number; role: WikiMemberGroup['role'] }>({
    mutationFn: ({ groupId, role }) => wikiApi.addMemberGroup(spaceId, groupId, role).then((r) => r.data),
    onSuccess: () => invalidateGroups(qc, spaceId),
    onError: (err) => handleApiError(err, '조직 추가에 실패했습니다'),
  })
}

// 부서 역할 변경 — 편집자·보기 전용만.
export function useUpdateWikiMemberGroupRole(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<WikiMemberGroup, unknown, { groupId: number; role: WikiMemberGroup['role'] }>({
    mutationFn: ({ groupId, role }) => wikiApi.updateMemberGroupRole(spaceId, groupId, role).then((r) => r.data),
    onSuccess: () => invalidateGroups(qc, spaceId),
    onError: (err) => handleApiError(err, '역할 변경에 실패했습니다'),
  })
}

// 부서 제거.
export function useRemoveWikiMemberGroup(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, number>({
    mutationFn: (groupId) => wikiApi.removeMemberGroup(spaceId, groupId).then((r) => r.data),
    onSuccess: () => {
      invalidateGroups(qc, spaceId)
      toast.success('조직을 제거했습니다')
    },
    onError: (err) => handleApiError(err, '조직 제거에 실패했습니다'),
  })
}
