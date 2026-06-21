// 이슈 첨부 목록 조회 훅 — projectKey/number 가 유효할 때만 활성화.

import { useQuery } from '@tanstack/react-query';

import { listAttachments } from '../../api/issueAttachments';

/** enabled 옵션을 외부에서 추가로 제어 가능 (driveLinksOnly 모드 등에서 불필요 요청 방지). */
export function useIssueAttachments(
  projectKey: string,
  number: number,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['attachments', projectKey, number],
    queryFn: () => listAttachments(projectKey, number),
    enabled: (options?.enabled ?? true) && !!projectKey && Number.isFinite(number),
  });
}
