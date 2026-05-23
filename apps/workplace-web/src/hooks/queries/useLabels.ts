// 프로젝트 라벨 조회 + CRUD mutation.
// invalidate 전략: 라벨 변경은 ['labels', projectKey] 갱신, 삭제는 검색 결과까지 함께 무효화.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { createLabel, deleteLabel, listLabels, updateLabel } from '../../api/labels';
import { handleApiError } from '../../lib/api-error';

// 프로젝트 라벨 전체 목록.
export function useLabels(projectKey: string) {
  return useQuery({
    queryKey: ['labels', projectKey],
    queryFn: () => listLabels(projectKey),
    enabled: !!projectKey,
  });
}

export function useCreateLabel(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; colorToken: string }) => createLabel(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labels', projectKey] });
      toast.success('라벨을 생성했습니다');
    },
    onError: (e) => handleApiError(e, '라벨 생성에 실패했습니다'),
  });
}

export function useUpdateLabel(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: { name: string; colorToken: string } }) =>
      updateLabel(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labels', projectKey] });
      toast.success('라벨을 수정했습니다');
    },
    onError: (e) => handleApiError(e, '라벨 수정에 실패했습니다'),
  });
}

export function useDeleteLabel(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteLabel(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labels', projectKey] });
      // 삭제된 라벨은 모든 이슈 카드/리스트에서도 빠져야 한다.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      toast.success('라벨을 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '라벨 삭제에 실패했습니다'),
  });
}
