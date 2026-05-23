// 이슈 첨부 목록 조회 훅 — projectKey/number 가 유효할 때만 활성화.

import { useQuery } from '@tanstack/react-query';

import { listAttachments } from '../../api/issueAttachments';

export function useIssueAttachments(projectKey: string, number: number) {
  return useQuery({
    queryKey: ['attachments', projectKey, number],
    queryFn: () => listAttachments(projectKey, number),
    enabled: !!projectKey && Number.isFinite(number),
  });
}
