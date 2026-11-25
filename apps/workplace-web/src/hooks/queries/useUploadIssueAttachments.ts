// 이슈 첨부 업로드 mutation — 25MB / 이슈당 20개 클라이언트 사전 검증을 통과한 파일만 단일 multipart POST.
// 한도를 넘는 파일은 파일마다 토스트하지 않고, 끝에 결과 토스트 하나(받은 수·제외 이름)로 알린다(WP-2118).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_ISSUE,
  uploadAttachments,
} from '../../api/issueAttachments';
import { handleApiError } from '../../lib/api-error';
import { oversizeFileMessage } from '../../lib/attachmentLimits';
import { splitByRemaining, uploadResultMessage } from '../../lib/issueAttachmentUpload';
import type { IssueDetailResponse } from '../../types/issue';
import { issueKeys } from './useIssues';

export function useUploadIssueAttachments(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    // currentCount 는 호출자(dropzone)가 detail.summary.attachmentCount 로 주입.
    mutationFn: async ({
      files,
      currentCount,
    }: {
      files: File[];
      currentCount: number;
    }) => {
      // 크기 초과는 지금처럼 파일별 토스트로 거른다.
      const sized: File[] = [];
      for (const f of files) {
        if (f.size > ATTACHMENT_MAX_BYTES) {
          toast.error(oversizeFileMessage(f.name));
          continue;
        }
        sized.push(f);
      }
      // 남은 자리만큼만 업로드하고 넘친 파일 이름은 결과 토스트에 모은다.
      const { accepted, excluded } = splitByRemaining(sized, currentCount, ATTACHMENT_MAX_PER_ISSUE);
      const excludedNames = excluded.map((f) => f.name);
      const added = accepted.length > 0 ? await uploadAttachments(projectKey, number, accepted) : [];
      return { added, excludedNames };
    },
    onSuccess: ({ added, excludedNames }) => {
      if (added.length > 0) {
        // 개수를 정하는 상세 캐시를 refetch 보다 먼저 올린다 — refetch 가 다른 무효화(SSE 등)에 취소돼도
        // 다음 묶음이 낡은 attachmentCount 로 잘못 잘리거나 서버 409 로 통째 거절되지 않는다(WP-2118).
        // 서버 응답이 오면 refetch 가 정확한 값으로 덮는다. 무효화는 기다리지 않는다.
        qc.setQueryData<IssueDetailResponse>(issueKeys.detail(projectKey, number), (old) =>
          old ? { ...old, summary: { ...old.summary, attachmentCount: old.summary.attachmentCount + added.length } } : old,
        );
        qc.invalidateQueries({ queryKey: ['attachments', projectKey, number] });
        // 무효화 범위는 기존 문자열 키와 같다(프로젝트의 모든 상세 — 상위·하위 이슈 개수 포함).
        qc.invalidateQueries({ queryKey: issueKeys.details(projectKey) });
        qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      }
      // 올린 것도 넘친 것도 없으면(크기 초과만) 추가 토스트 없음.
      if (added.length === 0 && excludedNames.length === 0) return;
      // 레벨(성공·경고·오류) 판정은 순수 함수가 한다(WP-2118).
      const { level, title, description } = uploadResultMessage(added.length, excludedNames, ATTACHMENT_MAX_PER_ISSUE);
      toast[level](title, description ? { description } : undefined);
    },
    onError: (e) => handleApiError(e, '첨부 업로드에 실패했습니다'),
  });
}
