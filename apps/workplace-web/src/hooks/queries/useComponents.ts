// 프로젝트 구성요소(WP-933) 조회 + 관리 mutation + 이슈 구성요소 교체.
// 쿼리 키 ['components', projectKey] 는 실시간 무효화 규칙(resourceInvalidation 의 component)과 같아야 다른 탭이 따라온다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  createComponent,
  deleteComponent,
  listComponents,
  replaceIssueComponents,
  updateComponent,
} from '../../api/components';
import { handleApiError } from '../../lib/api-error';
import type { CreateComponentRequest, UpdateComponentRequest } from '../../types/component';

/** 구성요소 목록 쿼리 키. */
export const componentKeys = {
  all: (projectKey: string) => ['components', projectKey] as const,
};

/** 프로젝트 구성요소 전체(보관 포함). enabled=false 면 요청하지 않는다(개인 프로젝트 등). */
export function useComponents(projectKey: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: componentKeys.all(projectKey),
    queryFn: () => listComponents(projectKey),
    enabled: !!projectKey && (options?.enabled ?? true),
  });
}

// 구성요소의 이름·보관 여부는 이슈 칩에도 보이므로, 바꾸면 이슈 목록·상세도 다시 읽는다.
function invalidateIssueViews(qc: ReturnType<typeof useQueryClient>, projectKey: string) {
  qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
  qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
}

/** 추가 — 실패 문구는 편집 대화창이 안에 보인다(라벨 편집과 같은 방식이라 토스트를 겹쳐 띄우지 않는다). */
export function useCreateComponent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateComponentRequest) => createComponent(projectKey, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: componentKeys.all(projectKey) });
      toast.success('구성요소를 추가했어요');
    },
  });
}

/** 부분 수정 — 편집 저장·보관·복원이 같이 쓴다. silent 면 성공 토스트를 직접 띄우는 호출부(보관·복원)가 문구를 정한다. */
export function useUpdateComponent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; body: UpdateComponentRequest }) => updateComponent(projectKey, v.id, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: componentKeys.all(projectKey) });
      invalidateIssueViews(qc, projectKey);
    },
  });
}

/** 삭제 — 붙어 있던 이슈에서도 빠지므로 이슈 화면까지 다시 읽는다. */
export function useDeleteComponent(projectKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteComponent(projectKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: componentKeys.all(projectKey) });
      invalidateIssueViews(qc, projectKey);
      toast.success('구성요소를 삭제했어요');
    },
    onError: (e) => handleApiError(e, '구성요소 삭제에 실패했습니다'),
  });
}

/** 이슈 구성요소 집합 교체 — 이슈 칩·목록과 구성요소별 이슈 수가 바뀐다. */
export function useUpdateIssueComponents(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (componentIds: number[]) => replaceIssueComponents(projectKey, number, componentIds),
    onSuccess: () => {
      invalidateIssueViews(qc, projectKey);
      qc.invalidateQueries({ queryKey: componentKeys.all(projectKey) });
      toast.success('구성요소를 저장했어요');
    },
    onError: (e) => handleApiError(e, '구성요소 저장에 실패했습니다'),
  });
}
