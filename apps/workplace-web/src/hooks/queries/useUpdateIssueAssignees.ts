// 이슈 담당자 집합 교체 mutation — Phase 3c.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { replaceIssueAssignees } from '../../api/issueAssignees';
import { extractApiErrorCode, handleApiError } from '../../lib/api-error';
import { issueWorkflowKey, workflowErrorMessage } from '../../lib/workflow';
import type { UserSummary } from '../../types/user';
import { chatKeys } from './chatKeys';
import { issueKeys } from './useIssues';

/** 담당 저장 인자 — startWorkflowId 가 있으면 「지정하고 바로 시작」(WP-1989). */
export interface UpdateIssueAssigneesArgs {
  userIds: number[];
  startWorkflowId?: number;
}

/** 저장 결과 — startError 는 시작만 실패하고 담당은 저장됐을 때의 이유(아니면 null). */
interface UpdateIssueAssigneesResult {
  users: UserSummary[];
  startError: string | null;
}

// 담당자 변경 시 detail/검색/watcher 캐시 invalidate.
// detail 은 프로젝트의 상세 접두사(issueKeys.details)로 폭넓게 무효화한다.
// issueId 는 시작 시 워크플로우 카드 캐시를 새로 읽기 위해 선택으로 받는다.
export function useUpdateIssueAssignees(projectKey: string, number: number, issueId?: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userIds, startWorkflowId }: UpdateIssueAssigneesArgs): Promise<UpdateIssueAssigneesResult> => {
      try {
        return { users: await replaceIssueAssignees(projectKey, number, userIds, startWorkflowId), startError: null };
      } catch (e) {
        // 시작 때문에 거절되면(오류 코드가 WORKFLOW_*; 상태는 403·404·409·422 로 갈린다) 서버가 담당 변경까지 되돌린다 —
        // 시작 없이 담당만 다시 저장하고 이유를 알린다. 담당 변경 자체의 오류(WORKFLOW_ 아님)는 재전송 없이 그대로 던진다.
        const code = extractApiErrorCode(e);
        if (startWorkflowId == null || code == null || !code.startsWith('WORKFLOW_')) throw e;
        const users = await replaceIssueAssignees(projectKey, number, userIds);
        return { users, startError: workflowErrorMessage(e, '워크플로우를 시작하지 못했어요.') };
      }
    },
    onSuccess: (res, vars) => {
      // 시작을 시도했으면(성공·실패 모두) 카드 캐시를 다시 읽는다.
      if (vars.startWorkflowId != null && issueId != null) {
        qc.invalidateQueries({ queryKey: issueWorkflowKey(issueId) });
      }
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      qc.invalidateQueries({ queryKey: issueKeys.details(projectKey) });
      qc.invalidateQueries({ queryKey: ['watchers', projectKey, number] });
      // 담당 AI 가 바뀌면 이슈 챗 작성창 안내가 바뀐다 — 스레드 응답의 externalAgent (WP-373).
      qc.invalidateQueries({ queryKey: chatKeys.thread(projectKey, number) });
      if (res.startError != null) toast.warning(`담당은 지정했어요 — 워크플로우는 시작하지 못했어요: ${res.startError}`);
      else toast.success('담당자를 저장했습니다');
    },
    onError: (e) => handleApiError(e, '담당자 저장에 실패했습니다'),
  });
}
