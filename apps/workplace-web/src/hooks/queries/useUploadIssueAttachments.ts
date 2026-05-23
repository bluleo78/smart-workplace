// 이슈 첨부 업로드 mutation — 25MB / 이슈당 10개 클라이언트 사전 검증을 통과한 파일만 단일 multipart POST.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_ISSUE,
  uploadAttachments,
} from '../../api/issueAttachments';
import { handleApiError } from '../../lib/api-error';

export function useUploadIssueAttachments(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    // currentCount 는 호출자(dropzone)가 detail.summary.attachmentCount 로 주입.
    mutationFn: async ({ files, currentCount }: { files: File[]; currentCount: number }) => {
      // 사전 검증 — 한도 초과 파일은 토스트로 스킵하고 통과된 파일만 모아 1회 업로드.
      const accepted: File[] = [];
      for (const f of files) {
        if (f.size > ATTACHMENT_MAX_BYTES) {
          toast.error(`${f.name} 은 25MB 한도를 초과합니다`);
          continue;
        }
        if (currentCount + accepted.length >= ATTACHMENT_MAX_PER_ISSUE) {
          toast.error(`이슈당 첨부 한도(${ATTACHMENT_MAX_PER_ISSUE}개) 초과 — ${f.name} 스킵`);
          continue;
        }
        accepted.push(f);
      }
      if (accepted.length === 0) return [];
      return await uploadAttachments(projectKey, number, accepted);
    },
    onSuccess: (added) => {
      if (added.length > 0) {
        qc.invalidateQueries({ queryKey: ['attachments', projectKey, number] });
        qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
        qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
        toast.success(`${added.length}개 첨부를 추가했습니다`);
      }
    },
    onError: (e) => handleApiError(e, '첨부 업로드에 실패했습니다'),
  });
}
