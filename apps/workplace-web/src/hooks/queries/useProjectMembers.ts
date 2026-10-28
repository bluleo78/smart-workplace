// 프로젝트 멤버 조회 + 추가/역할변경/삭제 mutation 훅.
// WP-1057 — 멤버 목록은 실효 멤버(직접 멤버 + 멤버로 둔 조직도 부서의 사람, direct=false)라 담당자·멘션·필터 후보가 그대로 쓴다.
// 멤버로 둔 부서 행은 member-groups 로 따로 받는다. 부서를 더하고 빼면 들어오는 사람이 바뀌므로 멤버 목록도 함께 다시 받는다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { projectsApi } from '../../api/projects';
import type { AddMemberRequest, UpdateMemberRoleRequest } from '../../types/project';
import { projectKeys } from './useProjects';

export const memberKeys = {
  all: (projectKey: string) => [...projectKeys.detail(projectKey), 'members'] as const,
  // 멤버로 둔 조직도 부서(WP-1057) — projects 아래라 project-member·project-member-group 실시간 변경(['projects'] 무효화)에 함께 다시 받는다.
  groups: (projectKey: string) => [...projectKeys.detail(projectKey), 'member-groups'] as const,
};

export function useProjectMembers(projectKey: string) {
  return useQuery({
    queryKey: memberKeys.all(projectKey),
    queryFn: () => projectsApi.listMembers(projectKey).then(r => r.data),
    enabled: !!projectKey,
  });
}

/** 멤버로 둔 조직도 부서 목록(WP-1057) — 팀 프로젝트의 멤버 관리 화면만 받는다(enabled). */
export function useProjectMemberGroups(projectKey: string, enabled = true) {
  return useQuery({
    queryKey: memberKeys.groups(projectKey),
    queryFn: () => projectsApi.listMemberGroups(projectKey).then(r => r.data),
    enabled: !!projectKey && enabled,
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

/** 부서 행 변경 뒤 — 부서 목록과, 부서로 들어오는 사람이 바뀐 멤버 목록(후보)을 함께 다시 받는다. */
function invalidateMembersAndGroups(qc: ReturnType<typeof useQueryClient>, projectKey: string) {
  qc.invalidateQueries({ queryKey: memberKeys.groups(projectKey) });
  qc.invalidateQueries({ queryKey: memberKeys.all(projectKey) });
}

/** 조직도 부서를 멤버로 더한다(WP-1057) — 역할은 늘 MEMBER. */
export function useAddMemberGroup(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: number) => projectsApi.addMemberGroup(projectKey, groupId).then(r => r.data),
    onSuccess: () => invalidateMembersAndGroups(qc, projectKey),
  });
}

/** 멤버 부서를 뺀다(WP-1057) — 부서로만 들어와 있던 사람은 서버가 멤버 제거처럼 정리한다. */
export function useRemoveMemberGroup(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: number) => projectsApi.removeMemberGroup(projectKey, groupId),
    onSuccess: () => invalidateMembersAndGroups(qc, projectKey),
  });
}
