// 이슈 의존성 add/remove mutation 훅 (Phase 4b).
// 성공 시 상세 + 검색 캐시를 invalidate 하여 헤더 ⛔ 배지 / 카드 마커 / 섹션 목록을 갱신.
// 토스트는 hook 이 처리. 호출 측(Picker/Row)은 close/poll 만 담당.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  addIssueDependency,
  removeIssueDependency,
  type DependencyDirection,
} from '../../api/issueDependencies';
import { handleApiError } from '../../lib/api-error';

import { issueKeys } from './useIssues';

export function useAddIssueDependency(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { otherNumber: number; direction: DependencyDirection }) =>
      addIssueDependency(projectKey, number, v.otherNumber, v.direction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      toast.success('의존성을 추가했습니다');
    },
    onError: (e) => handleApiError(e, '의존성 변경에 실패했습니다'),
  });
}

export function useRemoveIssueDependency(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { otherNumber: number; direction: DependencyDirection }) =>
      removeIssueDependency(projectKey, number, v.otherNumber, v.direction),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
      qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
      toast.success('의존성을 제거했습니다');
    },
    onError: (e) => handleApiError(e, '의존성 변경에 실패했습니다'),
  });
}
