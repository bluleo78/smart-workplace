// 이슈 의존성 add/remove mutation 훅 (Phase 4b).
// 성공 시 상세 + 검색 캐시를 invalidate 하여 헤더 ⛔ 배지 / 카드 마커 / 섹션 목록을 갱신.
// 토스트는 hook 이 처리. 호출 측(관계 추가 창·관계 줄)은 close 만 담당. 화면 말은 「차단」(WP-887 — 「의존성」 대신 관계 유형 이름).

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  addIssueDependency,
  type DependencyDirection,
  removeIssueDependency,
} from '../../api/issueDependencies';
import { handleApiError } from '../../lib/api-error';
import { issueKeys } from './useIssues';

/** 이 이슈와 상대 이슈 상세, 프로젝트 의존 간선을 무효화한다 — 상대 쪽 레일·배지도 바뀐다(관계 훅과 같은 규칙). */
function invalidateBoth(qc: QueryClient, projectKey: string, number: number, otherNumber: number) {
  qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, number) });
  qc.invalidateQueries({ queryKey: issueKeys.detail(projectKey, otherNumber) });
  qc.invalidateQueries({ queryKey: issueKeys.search(projectKey) });
  qc.invalidateQueries({ queryKey: ['issue-dependencies', projectKey] });
}

export function useAddIssueDependency(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { otherNumber: number; direction: DependencyDirection }) =>
      addIssueDependency(projectKey, number, v.otherNumber, v.direction),
    onSuccess: (_d, v) => {
      invalidateBoth(qc, projectKey, number, v.otherNumber);
      toast.success('차단 관계를 추가했습니다');
    },
    onError: (e) => handleApiError(e, '차단 관계를 추가하지 못했습니다'),
  });
}

export function useRemoveIssueDependency(projectKey: string, number: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { otherNumber: number; direction: DependencyDirection }) =>
      removeIssueDependency(projectKey, number, v.otherNumber, v.direction),
    onSuccess: (_d, v) => {
      invalidateBoth(qc, projectKey, number, v.otherNumber);
      toast.success('차단 관계를 제거했습니다');
    },
    onError: (e) => handleApiError(e, '차단 관계를 제거하지 못했습니다'),
  });
}
