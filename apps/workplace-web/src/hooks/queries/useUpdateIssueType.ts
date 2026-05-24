// 이슈 단건의 유형 변경 (PATCH /issues/{number}/type) 뮤테이션.
// 성공 시 검색 캐시 + 상세 캐시 invalidate.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueTypeOf } from '../../api/issueTypes';
import { handleApiError } from '../../lib/api-error';

export function useUpdateIssueType(projectKey: string, issueNumber: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (typeId: number) => updateIssueTypeOf(projectKey, issueNumber, typeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      toast.success('유형을 변경했습니다');
    },
    onError: (e) => handleApiError(e, '유형 변경에 실패했습니다'),
  });
}
