// 이슈 생성 mutation + 캐시 키 헬퍼.
// 검색/목록 조회는 useIssueSearch (cursor 기반 무한 스크롤) 에서 담당한다.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { issuesApi } from '../../api/issues';
import type { CreateIssueRequest } from '../../types/issue';

export const issueKeys = {
  all: ['issues'] as const,
  // 프로젝트 단위 list prefix — 페이지네이션/검색 키들을 한 번에 invalidate 할 때 사용.
  lists: (projectKey: string) => [...issueKeys.all, projectKey, 'list'] as const,
  search: (projectKey: string) => ['issues', 'search', projectKey] as const,
  detail: (projectKey: string, number: number) =>
    [...issueKeys.all, projectKey, 'detail', number] as const,
};

export function useCreateIssue(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIssueRequest) =>
      issuesApi.create(projectKey, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.lists(projectKey) });
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
    },
  });
}
