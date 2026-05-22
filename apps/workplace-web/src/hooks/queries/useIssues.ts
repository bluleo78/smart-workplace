// 이슈 목록 조회 + 생성 mutation 훅 (프로젝트 스코프).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { issuesApi } from '../../api/issues';
import type { CreateIssueRequest } from '../../types/issue';

export const issueKeys = {
  all: ['issues'] as const,
  // 프로젝트 단위 list prefix — 페이지네이션 키들을 한 번에 invalidate 할 때 사용
  lists: (projectKey: string) => [...issueKeys.all, projectKey, 'list'] as const,
  list: (projectKey: string, page: number, size: number) =>
    [...issueKeys.lists(projectKey), page, size] as const,
  detail: (projectKey: string, number: number) =>
    [...issueKeys.all, projectKey, 'detail', number] as const,
};

export function useIssues(projectKey: string, page = 0, size = 20) {
  return useQuery({
    queryKey: issueKeys.list(projectKey, page, size),
    queryFn: () => issuesApi.list(projectKey, { page, size }).then(r => r.data),
    enabled: !!projectKey,
  });
}

export function useCreateIssue(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIssueRequest) => issuesApi.create(projectKey, data).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.lists(projectKey) });
    },
  });
}
