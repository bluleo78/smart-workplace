// 이슈 단건 조회 + 수정/삭제 mutation 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { issuesApi } from '../../api/issues';
import type { UpdateIssueRequest } from '../../types/issue';

import { issueKeys } from './useIssues';

export function useIssue(projectKey: string, number: number) {
  return useQuery({
    queryKey: issueKeys.detail(projectKey, number),
    queryFn: () => issuesApi.get(projectKey, number).then(r => r.data),
    enabled: !!projectKey && Number.isFinite(number),
  });
}

export function useUpdateIssue(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateIssueRequest) =>
      issuesApi.update(projectKey, number, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
      qc.invalidateQueries({ queryKey: issueKeys.lists(projectKey) });
    },
  });
}

export function useDeleteIssue(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (number: number) => issuesApi.remove(projectKey, number),
    onSuccess: () => { qc.invalidateQueries({ queryKey: issueKeys.lists(projectKey) }); },
  });
}
