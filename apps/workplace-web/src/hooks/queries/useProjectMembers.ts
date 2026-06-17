// 프로젝트 멤버 조회 + 추가/역할변경/삭제 mutation 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { projectsApi } from '../../api/projects';
import type { AddMemberRequest, UpdateMemberRoleRequest } from '../../types/project';
import { projectKeys } from './useProjects';

export const memberKeys = {
  all: (projectKey: string) => [...projectKeys.detail(projectKey), 'members'] as const,
};

export function useProjectMembers(projectKey: string) {
  return useQuery({
    queryKey: memberKeys.all(projectKey),
    queryFn: () => projectsApi.listMembers(projectKey).then(r => r.data),
    enabled: !!projectKey,
  });
}

export function useAddMember(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: AddMemberRequest) => projectsApi.addMember(projectKey, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: memberKeys.all(projectKey) }); },
  });
}

export function useUpdateMemberRole(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { userId: number; data: UpdateMemberRoleRequest }) =>
      projectsApi.updateMemberRole(projectKey, params.userId, params.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: memberKeys.all(projectKey) }); },
  });
}

export function useRemoveMember(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => projectsApi.removeMember(projectKey, userId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: memberKeys.all(projectKey) }); },
  });
}
