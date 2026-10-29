// 드라이브 공간 멤버 조회 + 멤버 mutation 모음(WP-582, TEAM 공간 공유). 멤버인 조직도 부서(WP-1056)도 함께.
// 성공 시 멤버 목록·공간 목록·공간 단건(내 역할 변동 대비)을 무효화한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { driveApi } from '../../api/drive'
import { addGroupMembers } from '../../components/members/personalGroups'
import { handleApiError } from '../../lib/api-error'
import type { DriveMember, DriveMemberGroup, DriveRole } from '../../types/drive'
import { driveKeys } from './driveKeys'

// 멤버 목록 — 멤버 창이 열릴 때 마운트되어 조회한다.
export function useDriveMembers(spaceId: number) {
  return useQuery<DriveMember[]>({
    queryKey: driveKeys.members(spaceId),
    queryFn: () => driveApi.listMembers(spaceId).then((r) => r.data),
  })
}

// 공통 무효화 — 바뀐 목록(사람 멤버 또는 멤버 부서) + 공간 목록·단건(내 역할이 바뀌면 사이드바 ⋯·읽기 전용 판정이 달라진다).
function invalidate(
  qc: ReturnType<typeof useQueryClient>,
  spaceId: number,
  listKey: readonly unknown[] = driveKeys.members(spaceId),
) {
  qc.invalidateQueries({ queryKey: listKey })
  qc.invalidateQueries({ queryKey: driveKeys.spaces() })
  qc.invalidateQueries({ queryKey: driveKeys.space(spaceId) })
}

// 멤버 추가 — { userId, role }.
export function useAddDriveMember(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, { userId: number; role: DriveRole }>({
    mutationFn: ({ userId, role }) => driveApi.addMember(spaceId, userId, role).then((r) => r.data),
    onSuccess: () => invalidate(qc, spaceId),
    onError: (err) => handleApiError(err, '멤버 추가에 실패했습니다'),
  })
}

// 역할 변경 — OWNER 만 가능(서버 권한 검증).
export function useChangeDriveMemberRole(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, { userId: number; role: DriveRole }>({
    mutationFn: ({ userId, role }) => driveApi.changeMemberRole(spaceId, userId, role).then((r) => r.data),
    onSuccess: () => invalidate(qc, spaceId),
    onError: (err) => handleApiError(err, '역할 변경에 실패했습니다'),
  })
}

// 멤버 제거 — OWNER 만 가능.
export function useRemoveDriveMember(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, number>({
    mutationFn: (userId) => driveApi.removeMember(spaceId, userId).then((r) => r.data),
    onSuccess: () => {
      invalidate(qc, spaceId)
      toast.success('멤버를 제거했습니다')
    },
    onError: (err) => handleApiError(err, '멤버 제거에 실패했습니다'),
  })
}

// 멤버인 조직도 부서 목록(WP-1056) — 멤버 창이 열릴 때 마운트되어 조회한다.
export function useDriveMemberGroups(spaceId: number) {
  return useQuery<DriveMemberGroup[]>({
    queryKey: driveKeys.memberGroups(spaceId),
    queryFn: () => driveApi.listMemberGroups(spaceId).then((r) => r.data),
  })
}

// 부서 변경 뒤 무효화 — 부서 목록 + 공간 목록·단건(부서로 받은 내 역할이 바뀌면 사이드바·읽기 전용 판정이 달라진다).
// 사람 멤버 목록도 — 사람 행의 「조직으로 …」 안내(부서로 받는 역할, WP-1102)가 부서 역할을 따라 바뀐다.
const invalidateGroups = (qc: ReturnType<typeof useQueryClient>, spaceId: number) => {
  invalidate(qc, spaceId, driveKeys.memberGroups(spaceId))
  qc.invalidateQueries({ queryKey: driveKeys.members(spaceId) })
}

// 부서 추가 — { groupId, role }.
export function useAddDriveMemberGroup(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<DriveMemberGroup, unknown, { groupId: number; role: DriveMemberGroup['role'] }>({
    mutationFn: ({ groupId, role }) => driveApi.addMemberGroup(spaceId, groupId, role).then((r) => r.data),
    onSuccess: () => invalidateGroups(qc, spaceId),
    onError: (err) => handleApiError(err, '조직 추가에 실패했습니다'),
  })
}

// 부서 역할 변경 — 편집자·보기 전용만.
export function useChangeDriveMemberGroupRole(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<DriveMemberGroup, unknown, { groupId: number; role: DriveMemberGroup['role'] }>({
    mutationFn: ({ groupId, role }) => driveApi.changeMemberGroupRole(spaceId, groupId, role).then((r) => r.data),
    onSuccess: () => invalidateGroups(qc, spaceId),
    onError: (err) => handleApiError(err, '역할 변경에 실패했습니다'),
  })
}

// 부서 제거.
export function useRemoveDriveMemberGroup(spaceId: number) {
  const qc = useQueryClient()
  return useMutation<void, unknown, number>({
    mutationFn: (groupId) => driveApi.removeMemberGroup(spaceId, groupId).then((r) => r.data),
    onSuccess: () => {
      invalidateGroups(qc, spaceId)
      toast.success('조직을 제거했습니다')
    },
    onError: (err) => handleApiError(err, '조직 제거에 실패했습니다'),
  })
}

/**
 * 내 그룹 구성원을 사람 멤버(편집자)로 한꺼번에 더한다(WP-1056) — 서버 추가는 업서트라, 이미 멤버인 사람(다른 소유자·보기 전용 등)을 편집자로 덮어쓰지
 * 않도록 화면 캐시가 아니라 방금 받은 멤버 목록으로 거른다. 요청을 모두 기다린 뒤 무효화는 한 번만 하고, 더한·뺀·실패한 수를 돌려준다(안내는 부르는 쪽).
 */
export function useAddDriveMembersFromGroup(spaceId: number) {
  const qc = useQueryClient()
  return async (memberIds: number[]): Promise<{ added: number; skipped: number; failed: number }> => {
    const latest = await qc.fetchQuery({
      queryKey: driveKeys.members(spaceId),
      queryFn: () => driveApi.listMembers(spaceId).then((r) => r.data),
      staleTime: 0,
    })
    const current = latest.map((m) => m.userId)
    const { userIds, skipped } = addGroupMembers(current, memberIds)
    const fresh = userIds.slice(current.length)
    const results = await Promise.allSettled(fresh.map((userId) => driveApi.addMember(spaceId, userId, 'EDITOR')))
    const failed = results.filter((r) => r.status === 'rejected').length
    if (fresh.length > 0) invalidate(qc, spaceId)
    return { added: fresh.length - failed, skipped, failed }
  }
}
