// 이슈 단건 조회 + 수정 mutation 훅.

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
      // 단건 캐시 무효화
      qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
      // 검색/목록 캐시 무효화 — issueKeys.lists 는 어떤 useQuery도 사용하지 않으므로
      // 실제 목록·보드가 사용하는 issueKeys.search 키를 무효화한다 (#175).
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
    },
  });
}

// NOTE: useDeleteIssue 는 useIssues.ts 의 버전이 실제로 사용된다.
// 여기서 정의된 버전은 미사용 코드였으므로 제거 (#175).
