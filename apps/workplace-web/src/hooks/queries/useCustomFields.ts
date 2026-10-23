// 프로젝트 커스텀 필드 정의 조회 + CRUD mutation (Phase 4c).
// invalidate 전략: 정의 변경은 ['customFields', projectKey] 갱신,
// 삭제는 이슈 검색/상세까지 무효화 (해당 필드가 응답에서 사라져야 함).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createCustomField,
  deleteCustomField,
  listCustomFields,
  updateCustomField,
} from '../../api/customFields';
import { handleApiError } from '../../lib/api-error';

// 프로젝트 커스텀 필드 정의 전체 목록.
// enabled — 이슈 목록처럼 커스텀 필드 열이 켜졌을 때만 필요한 화면이 요청을 미룰 때(WP-270).
export function useCustomFields(projectKey: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['customFields', projectKey],
    queryFn: () => listCustomFields(projectKey),
    enabled: !!projectKey && enabled,
  });
}

export function useCreateCustomField(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; type: string; options?: string[] | null }) =>
      createCustomField(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customFields', projectKey] });
      toast.success('필드를 추가했습니다');
    },
    onError: (e) => handleApiError(e, '필드 변경에 실패했습니다'),
  });
}

export function useUpdateCustomField(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: { name: string; type: string; options?: string[] | null } }) =>
      updateCustomField(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customFields', projectKey] });
      toast.success('필드를 수정했습니다');
    },
    // 실패 문구는 편집 대화상자가 안에 보인다(WP-611) — 토스트까지 띄우면 같은 말이 두 번 나온다.
  });
}

export function useDeleteCustomField(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCustomField(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customFields', projectKey] });
      // 삭제된 필드는 모든 이슈 응답에서 빠져야 한다.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      toast.success('필드를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '필드 삭제에 실패했습니다'),
  });
}
