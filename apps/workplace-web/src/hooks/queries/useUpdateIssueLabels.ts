// 이슈 라벨 집합 교체 mutation.
// 검색/상세 캐시를 모두 무효화해 라벨 chip 이 즉시 반영되도록 한다.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueLabels } from '../../api/labels';
import { handleApiError } from '../../lib/api-error';

export function useUpdateIssueLabels(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelIds: number[]) => replaceIssueLabels(projectKey, number, labelIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      toast.success('라벨을 저장했습니다');
    },
    onError: (e) => handleApiError(e, '라벨 저장에 실패했습니다'),
  });
}
