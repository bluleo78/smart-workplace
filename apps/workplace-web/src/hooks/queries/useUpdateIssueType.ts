// 이슈 단건의 유형 변경 (PATCH /issues/{number}/type) 뮤테이션.
// 성공 시 검색 캐시 + 상세 캐시 invalidate.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueTypeOf } from '../../api/issueTypes';
import { handleApiError } from '../../lib/api-error';

export function useUpdateIssueType(
  projectKey: string,
  issueNumber: number,
  // silent: true 면 성공 토스트를 억제한다 — AI 분류 적용처럼 여러 mutation 을
  // 묶어 단일 통합 토스트로 대체하는 호출부에서 사용 (#578).
  options?: { silent?: boolean },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (typeId: number) => updateIssueTypeOf(projectKey, issueNumber, typeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      if (!options?.silent) toast.success('유형을 변경했습니다');
    },
    onError: (e) => handleApiError(e, '유형 변경에 실패했습니다'),
  });
}
