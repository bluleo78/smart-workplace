// SUBTASK 의 부모 설정/해제 mutation (Phase 4a).
// 성공 시 detail + search 캐시 invalidate.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueParent } from '../../api/issueParent';
import { handleApiError } from '../../lib/api-error';

export function useUpdateIssueParent(projectKey: string, issueNumber: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (parentNumber: number | null) =>
      updateIssueParent(projectKey, issueNumber, parentNumber),
    onSuccess: () => {
      // detail / search 두 키 모두 prefix 매치로 invalidate.
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('부모를 저장했습니다');
    },
    onError: (e) => handleApiError(e, '부모 저장에 실패했습니다'),
  });
}
