// 이슈 담당자 집합 교체 mutation — Phase 3c.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueAssignees } from '../../api/issueAssignees';
import { handleApiError } from '../../lib/api-error';
import { chatKeys } from './chatKeys';

// 담당자 변경 시 detail/검색/watcher 캐시 invalidate.
// detail 키는 useIssue 의 ['issues', projectKey, 'detail', number] 패턴과 매칭되도록
// prefix(['issues', projectKey, 'detail']) 로 폭넓게 무효화한다.
export function useUpdateIssueAssignees(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: number[]) => replaceIssueAssignees(projectKey, number, userIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      qc.invalidateQueries({ queryKey: ['watchers', projectKey, number] });
      // 담당 AI 가 바뀌면 이슈 챗 작성창 안내가 바뀐다 — 스레드 응답의 externalAgent (WP-373).
      qc.invalidateQueries({ queryKey: chatKeys.thread(projectKey, number) });
      toast.success('담당자를 저장했습니다');
    },
    onError: (e) => handleApiError(e, '담당자 저장에 실패했습니다'),
  });
}
