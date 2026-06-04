import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { userGroupsApi } from '../../api/userGroups'
import { handleApiError } from '../../lib/api-error'
import type {
  AddMemberRequest,
  CreateUserGroupRequest,
  GroupMemberType,
  UpdateUserGroupRequest,
} from '../../types/userGroup'
import { userGroupKeys } from './userGroupKeys'

export function useCreateUserGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateUserGroupRequest) => userGroupsApi.create(body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userGroupKeys.all })
      toast.success('그룹을 생성했습니다')
    },
    onError: (e) => handleApiError(e, '그룹 생성에 실패했습니다'),
  })
}

export function useUpdateUserGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: UpdateUserGroupRequest }) =>
      userGroupsApi.update(id, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userGroupKeys.all })
      toast.success('그룹을 수정했습니다')
    },
    onError: (e) => handleApiError(e, '그룹 수정에 실패했습니다'),
  })
}

export function useDeleteUserGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => userGroupsApi.remove(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: userGroupKeys.all })
      toast.success('그룹을 삭제했습니다')
    },
    onError: (e) => handleApiError(e, '그룹 삭제에 실패했습니다'),
  })
}

export function useAddGroupMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AddMemberRequest }) =>
      userGroupsApi.addMember(id, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userGroupKeys.all }),
    onError: (e) => handleApiError(e, '멤버 편입에 실패했습니다'),
  })
}

export function useRemoveGroupMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, targetType, targetId }: { id: number; targetType: GroupMemberType; targetId: number }) =>
      userGroupsApi.removeMember(id, targetType, targetId).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userGroupKeys.all }),
    onError: (e) => handleApiError(e, '멤버 제외에 실패했습니다'),
  })
}
