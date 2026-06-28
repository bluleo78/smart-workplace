// 이슈 단건 조회 + 수정 mutation 훅.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { issuesApi } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
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
      // 홈 합성 위젯의 마감 마커(useMyIssueDues, ['my-issue-dues', from, to])도 무효화 —
      // 마감일 변경이 홈 "오늘 마감" 카운트·주의 항목에 즉시 반영되도록 prefix 로 모든 날짜범위를 무효화한다.
      qc.invalidateQueries({ queryKey: ['my-issue-dues'] });
    },
  });
}

// NOTE: useDeleteIssue 는 useIssues.ts 의 버전이 실제로 사용된다.
// 여기서 정의된 버전은 미사용 코드였으므로 제거 (#175).

// 이슈 AI 현황 요약 생성/재생성 mutation.
// 성공 시 이슈 상세 캐시를 무효화해 카드가 최신 summary 를 즉시 반영한다.
export function useGenerateAiSummary(projectKey: string, number: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => issuesApi.generateAiSummary(projectKey, number).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) }),
    onError: (e) => handleApiError(e, 'AI 요약 생성에 실패했습니다'),
  })
}
