// 마일스톤 조회/CRUD.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from '../../api/milestones';
import { handleApiError } from '../../lib/api-error';
import type { MilestoneRequest } from '../../types/milestone';

// 프로젝트 마일스톤 전체 목록.
export function useMilestones(projectKey: string) {
  return useQuery({
    queryKey: ['milestones', projectKey],
    queryFn: () => listMilestones(projectKey),
    enabled: !!projectKey,
  });
}

export function useCreateMilestone(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MilestoneRequest) => createMilestone(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('마일스톤을 생성했습니다');
    },
    onError: (e) => handleApiError(e, '마일스톤 생성에 실패했습니다'),
  });
}

export function useUpdateMilestone(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: MilestoneRequest }) =>
      updateMilestone(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('마일스톤을 수정했습니다');
    },
    onError: (e) => handleApiError(e, '마일스톤 수정에 실패했습니다'),
  });
}

export function useDeleteMilestone(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMilestone(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectKey] });
      // 마일스톤 삭제로 연결 해제된 이슈도 반영 — queryKey 접두사 매칭으로 전체 캐시 갱신.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('마일스톤을 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '마일스톤 삭제에 실패했습니다'),
  });
}
