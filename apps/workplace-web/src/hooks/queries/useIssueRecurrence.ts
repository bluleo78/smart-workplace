// 개인 작업 반복 조회·저장·끄기(WP-989).
// 저장·끄기는 서버가 그 AI 의 agent_work(다음 회차 대기·취소)도 바꾸고, 저장하면 내 AI 비서를 담당에 넣으므로
// AI 위임 작업 목록·건수('ai-tasks'), 작업 상세(담당자·AI 진행), 개인 프로젝트 작업 목록(담당 아바타)을 다시 받는다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { deleteIssueRecurrence, fetchIssueRecurrence, putIssueRecurrence } from '../../api/issueRecurrence';
import { handleApiError } from '../../lib/api-error';
import type { IssueRecurrence, PutIssueRecurrenceRequest } from '../../types/issueRecurrence';
import { issueKeys } from './useIssues';

export const issueRecurrenceKey = (projectKey: string, number: number) => ['issue-recurrence', projectKey, number] as const;

/** 반복 조회 — 없으면 data=null. */
export function useIssueRecurrence(projectKey: string, number: number) {
  return useQuery<IssueRecurrence | null, Error>({
    queryKey: issueRecurrenceKey(projectKey, number),
    queryFn: () => fetchIssueRecurrence(projectKey, number),
  });
}

/** 저장·끄기 공통 후처리 — 반복 캐시를 응답으로 바꾸고 AI 작업 목록·이슈 상세를 무효화한다. */
function useAfterChange(projectKey: string, number: number) {
  const qc = useQueryClient();
  return (next: IssueRecurrence | null) => {
    qc.setQueryData(issueRecurrenceKey(projectKey, number), next);
    qc.invalidateQueries({ queryKey: ['ai-tasks'] });
    qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
    qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
  };
}

/** 반복 저장(PUT) — 409(개인 작업 아님·담당에 AI 비서 없음)는 서버 문구를 토스트로 보인다. */
export function useSaveIssueRecurrence(projectKey: string, number: number) {
  const after = useAfterChange(projectKey, number);
  return useMutation({
    mutationFn: (body: PutIssueRecurrenceRequest) => putIssueRecurrence(projectKey, number, body),
    onSuccess: (data) => {
      after(data);
      toast.success('반복을 저장했습니다');
    },
    onError: (e) => handleApiError(e, '반복을 저장하지 못했습니다'),
  });
}

/** 반복 끄기(DELETE). */
export function useDeleteIssueRecurrence(projectKey: string, number: number) {
  const after = useAfterChange(projectKey, number);
  return useMutation({
    mutationFn: () => deleteIssueRecurrence(projectKey, number),
    onSuccess: () => {
      after(null);
      toast.success('반복을 껐습니다');
    },
    onError: (e) => handleApiError(e, '반복을 끄지 못했습니다'),
  });
}
