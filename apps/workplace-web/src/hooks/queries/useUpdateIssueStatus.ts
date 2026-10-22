// DnD 전용 — 이슈 상태 변경 mutation.
// onMutate 에서 ['issues','search',projectKey] prefix 의 모든 InfiniteData 캐시를 패치하고,
// 실패 시 스냅샷 복원 + 토스트, 성공/실패 무관 onSettled 에서 무효화 동기화한다.
// closedHiding — 종료 이슈를 숨기는 화면이면, 바꾼 이슈가 숨겨질 때 성공 토스트에 이유와 「모두 보기」를 붙인다(WP-606).

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type IssueStatusUpdateBody, updateIssueStatus } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { ClosedHidingNotice } from '../../lib/closedHiding';
import type { IssueResponse, IssueStatus } from '../../types/issue';
import { toastStatusChange } from './closedHidingToast';
import { patchIssueInSearchCache } from './issueSearchCache';

/**
 * 상태 변경 변수 — status 는 대상 범주(종료 안내 토스트·낙관적 범주 아이콘용), statusId·statusName 은 프로젝트 상태(WP-808).
 * statusId 는 선택이다: 프로젝트 상태를 고르는 화면은 넘기고, 범주만 아는 예전 호출부는 그대로 status 만 넘긴다.
 */
export interface UpdateIssueStatusVars {
  number: number;
  status: IssueStatus;
  statusId?: number;
  statusName?: string;
}

/** 서버로 보낼 본문 — statusId 가 있으면 그것만(서버는 statusId 를 범주보다 우선한다), 없으면 범주. */
export function statusRequestBody({ status, statusId }: UpdateIssueStatusVars): IssueStatusUpdateBody {
  return statusId != null ? { statusId } : { status };
}

/**
 * 검색 캐시 낙관적 패치 — 범주는 늘, 프로젝트 상태 id·이름은 알 때만 덮는다.
 * 보드는 모든 컬럼 쿼리를 합친 뒤 이슈 필드로 다시 나누므로(IssueBoardView), 제자리 패치만으로 카드가 대상 컬럼으로 바로 옮겨 간다.
 */
export function statusCachePatch({ status, statusId, statusName }: UpdateIssueStatusVars): Partial<IssueResponse> {
  return {
    status,
    ...(statusId != null && { statusId }),
    ...(statusName != null && { statusName }),
  };
}

export function useUpdateIssueStatus(projectKey: string, closedHiding?: ClosedHidingNotice) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: UpdateIssueStatusVars) => updateIssueStatus(projectKey, vars.number, statusRequestBody(vars)),
    // 진행 중인 검색 쿼리 취소 + 스냅샷 + 패치를 공용 헬퍼로 — 실패 시 restore() 로 되돌린다.
    onMutate: (vars) => patchIssueInSearchCache(qc, projectKey, vars.number, statusCachePatch(vars)),
    onError: (err, _vars, ctx) => {
      ctx?.restore();
      handleApiError(err, '태스크 상태 변경에 실패했습니다');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
    },
    onSuccess: (_res, { number, status }) => {
      void toastStatusChange(projectKey, [number], status, closedHiding, 'success', '상태를 변경했습니다');
    },
  });
}
