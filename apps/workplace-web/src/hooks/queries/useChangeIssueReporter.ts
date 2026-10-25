// 이슈 보고자 변경 mutation(WP-944) — 담당자 교체(useUpdateIssueAssignees)와 같은 캐시 무효화.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { changeIssueReporter } from '../../api/issueReporter';
import { handleApiError } from '../../lib/api-error';

// 상세(보고자·권한 플래그·이력)·검색 목록(보고자 필터)·watcher(새 보고자 자동 구독)를 다시 받는다.
export function useChangeIssueReporter(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => changeIssueReporter(projectKey, number, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      qc.invalidateQueries({ queryKey: ['watchers', projectKey, number] });
      toast.success('보고자를 바꿨습니다');
    },
    onError: (e) => handleApiError(e, '보고자를 바꾸지 못했습니다'),
  });
}
