// 저장된 뷰 쿼리/뮤테이션 — 목록 + CRUD.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createSavedView,
  deleteSavedView,
  listMyPinnedViews,
  listSavedViews,
  pinSavedView,
  updateSavedView,
} from '../../api/savedViews';
import { handleApiError } from '../../lib/api-error';
import type { SavedViewResponse, SaveViewRequest } from '../../types/savedView';

// 프로젝트의 저장된 뷰 목록. enabled=false 면 요청하지 않는다(서버가 멤버 전용이라 비멤버는 403 — WP-741).
export function useSavedViews(projectKey: string, enabled = true) {
  return useQuery({
    queryKey: ['savedViews', projectKey],
    queryFn: () => listSavedViews(projectKey),
    enabled: !!projectKey && enabled,
  });
}

// 뷰 저장.
export function useCreateSavedView(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveViewRequest) => createSavedView(projectKey, body),
    onSuccess: (created) => {
      // 다시 불러오기 전에 목록 캐시에 먼저 넣는다 — 호출부가 막 만든 뷰를 바로 활성으로 고를 때(useSavedViewState.select),
      // 목록에 아직 없으면 일치 판정이 다른 뷰로 선택을 되돌릴 수 있다(WP-270).
      qc.setQueryData<SavedViewResponse[]>(['savedViews', projectKey], (old) =>
        old ? [...old.filter((v) => v.id !== created.id), created] : old,
      );
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
      // 고정된 뷰가 삭제된 경우 사이드바(useMyPinnedViews)도 갱신되어야 함(#614).
      // 고정 여부와 무관하게 항상 무효화(비용 낮음, usePinSavedView 와 동일 패턴).
      qc.invalidateQueries({ queryKey: ['pinnedViews'] });
      toast.success('뷰를 삭제했습니다');
    },
    onError: (e) => handleApiError(e, '뷰 삭제에 실패했습니다'),
  });
}

/** 사용자의 프로젝트 교차 고정뷰 (사이드바). */
export function useMyPinnedViews() {
  return useQuery({
    queryKey: ['pinnedViews'],
    queryFn: listMyPinnedViews,
  });
}

/** 저장된 뷰 사이드바 고정/해제. */
export function usePinSavedView(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; pinned: boolean }) =>
      pinSavedView(projectKey, v.id, v.pinned),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['savedViews', projectKey] });
      qc.invalidateQueries({ queryKey: ['pinnedViews'] });
      toast.success(v.pinned ? '사이드바에 고정했습니다' : '고정을 해제했습니다');
    },
    onError: (e) => handleApiError(e, '고정 변경에 실패했습니다'),
  });
}
