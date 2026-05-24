// 이슈 커스텀 필드 값 PUT mutation (Phase 4c).
// debounce 는 호출자가 책임진다 (CustomFieldsSection 가 300ms).
// 백엔드는 incoming 만 처리하므로 변경 필드만 보내면 OK.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueFieldValues } from '../../api/customFields';
import { handleApiError } from '../../lib/api-error';

export function useUpdateIssueFields(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { defId: number; value: unknown }[]) =>
      updateIssueFieldValues(projectKey, number, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('필드 값을 저장했습니다');
    },
    onError: (e) => handleApiError(e, '필드 변경에 실패했습니다'),
  });
}
