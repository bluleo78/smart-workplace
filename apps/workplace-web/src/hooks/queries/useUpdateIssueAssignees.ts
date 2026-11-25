// 이슈 담당자 집합 교체 mutation — Phase 3c.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueAssignees } from '../../api/issueAssignees';
import { handleApiError } from '../../lib/api-error';
import { issueWorkflowKey } from '../../lib/workflow';
import { chatKeys } from './chatKeys';
import { issueKeys } from './useIssues';

/** 담당 저장 인자. */
export interface UpdateIssueAssigneesArgs {
  userIds: number[];
}

// 담당자 변경 시 detail/검색/watcher 캐시 invalidate.
// detail 은 프로젝트의 상세 접두사(issueKeys.details)로 폭넓게 무효화한다.
// issueId 는 서버가 담당 지정과 함께 워크플로우를 자동 시작할 수 있어(WP-2120) 카드 캐시를 새로 읽기 위해 선택으로 받는다.
export function useUpdateIssueAssignees(projectKey: string, number: number, issueId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userIds }: UpdateIssueAssigneesArgs) => replaceIssueAssignees(projectKey, number, userIds),
    onSuccess: () => {
      // 자동 시작된 실행을 카드가 바로 보이게 한다(시작이 없었어도 무해).
      if (issueId != null) qc.invalidateQueries({ queryKey: issueWorkflowKey(issueId) });
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      qc.invalidateQueries({ queryKey: issueKeys.details(projectKey) });
      qc.invalidateQueries({ queryKey: ['watchers', projectKey, number] });
      // 담당 AI 가 바뀌면 이슈 챗 작성창 안내가 바뀐다 — 스레드 응답의 externalAgent (WP-373).
      qc.invalidateQueries({ queryKey: chatKeys.thread(projectKey, number) });
      toast.success('담당자를 저장했습니다');
    },
    onError: (e) => handleApiError(e, '담당자 저장에 실패했습니다'),
  });
}
