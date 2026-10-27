// 이슈 부모 설정/해제 mutation (Phase 4a).
// 성공 시 detail + search 캐시 invalidate. 부모가 다른 프로젝트 에픽이면(WP-1039) 새 부모·이전 부모 프로젝트의 에픽 상세·하위 목록·검색도 갱신한다
// — 그 에픽의 진행률·하위 목록이 바뀐다.

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { updateIssueParent } from '../../api/issueParent';
import { handleApiError } from '../../lib/api-error';
import { isHiddenParent, parentProjectKey, type ParentTargetInput } from '../../lib/parentRef';
import type { ParentRef } from '../../types/issue';
import { issueKeys } from './useIssues';

/**
 * 부모 변경에 걸린 캐시를 무효화한다 — 자식 프로젝트는 상세·검색(에픽 하위 목록 포함)을 통째로, 이전·새 부모가 다른 프로젝트 에픽이면 그 에픽의
 * 상세(진행률)·하위 목록만 갱신한다(그 프로젝트의 다른 이슈는 바뀌지 않는다). 가려진 부모는 프로젝트를 몰라 뺀다.
 */
export function invalidateParentChange(
  qc: QueryClient,
  childProjectKey: string,
  parents: (ParentTargetInput | Pick<ParentRef, 'projectKey' | 'number' | 'hidden'> | null | undefined)[],
) {
  qc.invalidateQueries({ queryKey: issueKeys.details(childProjectKey) });
  qc.invalidateQueries({ queryKey: issueKeys.search(childProjectKey) });
  for (const p of parents) {
    if (p == null || ('hidden' in p && isHiddenParent(p))) continue;
    const key = parentProjectKey(p, childProjectKey);
    if (key === childProjectKey) continue;
    qc.invalidateQueries({ queryKey: issueKeys.detail(key, p.number) });
    qc.invalidateQueries({ queryKey: issueKeys.children(key, p.number) });
  }
}

/**
 * @param previousParent 지금 부모 — 다른 프로젝트 에픽이면 그 프로젝트의 에픽 진행률·하위 목록도 성공 뒤 갱신한다.
 */
export function useUpdateIssueParent(projectKey: string, issueNumber: number, previousParent?: ParentRef | null) {
  const qc = useQueryClient();
  return useMutation({
    // { number } = 같은 프로젝트 부모, { projectKey, number } = (다른 프로젝트일 수 있는) 에픽, null = 해제.
    mutationFn: (parent: ParentTargetInput | null) => updateIssueParent(projectKey, issueNumber, parent),
    onSuccess: (_data, parent) => {
      invalidateParentChange(qc, projectKey, [previousParent, parent]);
      toast.success('부모를 저장했습니다');
    },
    onError: (e) => handleApiError(e, '부모 저장에 실패했습니다'),
  });
}
