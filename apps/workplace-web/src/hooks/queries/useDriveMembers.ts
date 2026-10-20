// 드라이브 공간 멤버 조회 + 멤버 mutation 모음(WP-582, TEAM 공간 공유).
// 성공 시 멤버 목록·공간 목록·공간 단건(내 역할 변동 대비)을 무효화한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { driveApi } from '../../api/drive'
import { handleApiError } from '../../lib/api-error'
import type { DriveMember, DriveRole } from '../../types/drive'
import { driveKeys } from './driveKeys'

// 멤버 목록 — 멤버 창이 열릴 때 마운트되어 조회한다.
export function useDriveMembers(spaceId: number) {
  return useQuery<DriveMember[]>({
    queryKey: driveKeys.members(spaceId),
    queryFn: () => driveApi.listMembers(spaceId).then((r) => r.data),
  })
}

// 공통 무효화 — 멤버 목록 + 공간 목록·단건(내 역할이 바뀌면 사이드바 ⋯·읽기 전용 판정이 달라진다).
function invalidate(qc: ReturnType<typeof useQueryClient>, spaceId: number) {
  qc.invalidateQueries({ queryKey: driveKeys.members(spaceId) })
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
