// 이슈 첨부 삭제 mutation — 백엔드 가드(첨부자/OWNER)가 최종 검증.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { deleteAttachment } from '../../api/issueAttachments';
import { handleApiError } from '../../lib/api-error';

export function useDeleteIssueAttachment(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: number) => deleteAttachment(projectKey, number, fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', projectKey, number] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('첨부를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '첨부 삭제에 실패했습니다'),
  });
}
