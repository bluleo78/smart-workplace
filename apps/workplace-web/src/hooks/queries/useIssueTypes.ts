// 이슈 유형 정의 (Issue Type) 쿼리/뮤테이션 훅.
// 목록 + OWNER 전용 CRUD.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createIssueType,
  deleteIssueType,
  listIssueTypes,
  updateIssueType,
  type IssueTypeMutationBody,
} from '../../api/issueTypes';
import { handleApiError } from '../../lib/api-error';

// 프로젝트의 유형 목록.
export function useIssueTypes(projectKey: string) {
  return useQuery({
    queryKey: ['issueTypes', projectKey],
    queryFn: () => listIssueTypes(projectKey),
    enabled: !!projectKey,
  });
}

// OWNER — CUSTOM 유형 추가.
export function useCreateIssueType(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IssueTypeMutationBody) => createIssueType(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issueTypes', projectKey] });
      toast.success('유형을 추가했습니다');
    },
    onError: (e) => handleApiError(e, '유형 추가에 실패했습니다'),
  });
}

// OWNER — CUSTOM 유형 수정. (시스템 유형은 백엔드에서 409.)
export function useUpdateIssueTypeDef(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: IssueTypeMutationBody }) =>
      updateIssueType(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issueTypes', projectKey] });
      toast.success('유형을 수정했습니다');
    },
    onError: (e) => handleApiError(e, '유형 수정에 실패했습니다'),
  });
}

// OWNER — CUSTOM 유형 삭제. 사용 중이면 백엔드에서 409.
export function useDeleteIssueType(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteIssueType(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issueTypes', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('유형을 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '유형 삭제에 실패했습니다'),
  });
}
