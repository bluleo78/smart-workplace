// 타임라인 간트 드래그 편집(막대 이동/리사이즈) 전용 PATCH mutation.
// 페이지 내 여러 이슈를 대상으로 하므로 이슈번호를 mutate 시점 인자로 받는다
// (다른 useUpdateIssue* 훅들은 단일 이슈에 고정되어 부적합).
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { issuesApi } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { UpdateIssueRequest } from '../../types/issue';

export function useTimelineIssueUpdate(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, data }: { number: number; data: UpdateIssueRequest }) =>
      issuesApi.update(projectKey, number, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
    },
    // 실패 시에도 재조회로 서버 진실 복원 — SVAR 내부 상태는 이미 드래그 위치로 이동해 있어
    // invalidate 없이는 화면이 실패한 변경 상태로 남는다.
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      handleApiError(e, '일정 변경에 실패했습니다');
    },
  });
}
