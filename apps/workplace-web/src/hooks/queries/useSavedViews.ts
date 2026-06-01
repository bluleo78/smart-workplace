// 저장된 뷰 쿼리/뮤테이션 — 목록 + CRUD.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  updateSavedView,
} from '../../api/savedViews';
import { handleApiError } from '../../lib/api-error';
import type { SaveViewRequest } from '../../types/savedView';

// 프로젝트의 저장된 뷰 목록.
export function useSavedViews(projectKey: string) {
  return useQuery({
    queryKey: ['savedViews', projectKey],
    queryFn: () => listSavedViews(projectKey),
    enabled: !!projectKey,
  });
}

// 뷰 저장.
export function useCreateSavedView(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveViewRequest) => createSavedView(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] });
      toast.success('뷰를 저장했습니다');
    },
    onError: (e) => handleApiError(e, '뷰 저장에 실패했습니다'),
  });
}

// 뷰 수정. (Task 5 에서 사용.)
export function useUpdateSavedView(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: SaveViewRequest }) =>
      updateSavedView(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] });
      toast.success('뷰를 수정했습니다');
    },
    onError: (e) => handleApiError(e, '뷰 수정에 실패했습니다'),
  });
}

// 뷰 삭제.
export function useDeleteSavedView(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSavedView(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] });
      toast.success('뷰를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '뷰 삭제에 실패했습니다'),
  });
}
