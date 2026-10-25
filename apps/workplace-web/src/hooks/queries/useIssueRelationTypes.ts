// 이슈 관계 유형 조회·관리 훅(WP-887).
// 조회(useIssueRelationTypes)는 레일 묶음 정렬·관계 추가 창이, 관리 훅은 설정 「앱 설정 › 작업 관리」가 쓴다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { issueRelationsApi, issueRelationTypesAdminApi } from '../../api/issueRelations';
import { handleApiError } from '../../lib/api-error';
import type { SaveIssueRelationTypeRequest } from '../../types/issue';
import { issueKeys } from './useIssues';

export const issueRelationTypeKeys = {
  all: ['issue-relation-types'] as const,
  list: () => [...issueRelationTypeKeys.all, 'list'] as const,
  admin: () => [...issueRelationTypeKeys.all, 'admin'] as const,
};

/**
 * 관계 유형 목록 — 워크스페이스 공통이라 자주 바뀌지 않는다(5분 신선).
 * enabled 로 필요할 때만 부른다 — 관계가 하나도 없는 이슈 화면에서까지 요청하지 않게.
 */
export function useIssueRelationTypes(enabled = true) {
  return useQuery({
    queryKey: issueRelationTypeKeys.list(),
    queryFn: issueRelationsApi.listTypes,
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** 관리 화면 목록 — 유형별 쓰이는 곳 수 포함. */
export function useAdminIssueRelationTypes() {
  return useQuery({ queryKey: issueRelationTypeKeys.admin(), queryFn: issueRelationTypesAdminApi.list });
}

/**
 * 관리 변경 뒤 공통 무효화 — 유형 목록(관리·조회) + 이슈 상세(이미 걸린 관계의 말이 바뀌거나 옮겨지므로).
 * 이슈 캐시는 무효 표시만 되고, 지금 열린 화면이 없으면 다음에 열 때 다시 받는다.
 */
function useInvalidateAfterTypeChange() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: issueRelationTypeKeys.all });
    void qc.invalidateQueries({ queryKey: issueKeys.all });
  };
}

/** 사용자 정의 유형 추가 — 실패(이름 중복 등)는 호출한 창이 안에 보여 준다(토스트 없음). */
export function useCreateIssueRelationType() {
  const invalidate = useInvalidateAfterTypeChange();
  return useMutation({
    mutationFn: (body: SaveIssueRelationTypeRequest) => issueRelationTypesAdminApi.create(body),
    onSuccess: () => {
      invalidate();
      toast.success('관계 유형을 추가했습니다');
    },
  });
}

/** 사용자 정의 유형 편집 — 실패는 창 안에 보인다. */
export function useUpdateIssueRelationType() {
  const invalidate = useInvalidateAfterTypeChange();
  return useMutation({
    mutationFn: (v: { id: number; body: SaveIssueRelationTypeRequest }) => issueRelationTypesAdminApi.update(v.id, v.body),
    onSuccess: () => {
      invalidate();
      toast.success('관계 유형을 고쳤습니다');
    },
  });
}

/** 숨기기·다시 보이기 — 표의 버튼 한 번이라 실패는 토스트로. */
export function useSetIssueRelationTypeHidden() {
  const invalidate = useInvalidateAfterTypeChange();
  return useMutation({
    mutationFn: (v: { id: number; hidden: boolean }) => issueRelationTypesAdminApi.setHidden(v.id, v.hidden),
    onSuccess: (_d, v) => {
      invalidate();
      toast.success(v.hidden ? '관계 유형을 숨겼습니다' : '관계 유형을 다시 보이게 했습니다');
    },
    onError: (e) => handleApiError(e, '관계 유형을 바꾸지 못했습니다'),
  });
}

/** 유형 삭제(옮기기·함께 삭제 포함) — 실패(사용 중 409 등)는 삭제 창이 코드로 갈라 보여 준다. */
export function useDeleteIssueRelationType() {
  const invalidate = useInvalidateAfterTypeChange();
  return useMutation({
    mutationFn: (v: { id: number; moveTo?: number; deleteLinks?: boolean }) =>
      issueRelationTypesAdminApi.remove(v.id, { moveTo: v.moveTo, deleteLinks: v.deleteLinks }),
    onSuccess: () => {
      invalidate();
      toast.success('관계 유형을 삭제했습니다');
    },
  });
}
