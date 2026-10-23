// DnD 전용 — 이슈 상태 변경 mutation.
// onMutate 에서 ['issues','search',projectKey] prefix 의 모든 InfiniteData 캐시를 패치하고,
// 실패 시 스냅샷 복원 + 토스트, 성공/실패 무관 onSettled 에서 무효화 동기화한다.
// closedHiding — 종료 이슈를 숨기는 화면이면, 바꾼 이슈가 숨겨질 때 성공 토스트에 이유와 「모두 보기」를 붙인다(WP-606).

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { type IssueStatusUpdateBody, updateIssueStatus } from '../../api/issues';
import { handleApiError } from '../../lib/api-error';
import type { ClosedHidingNotice } from '../../lib/closedHiding';
import type { IssueResponse, IssueStatus } from '../../types/issue';
import type { ProjectStatus } from '../../types/projectStatus';
import { toastStatusChange } from './closedHidingToast';
import { copyIssueIntoStatusColumn, patchIssueInSearchCache } from './issueSearchCache';

/** 상태 변경 변수 — 옮겨 갈 프로젝트 상태(WP-808). 호출부(보드 드롭·행 메뉴)는 늘 고른 상태 전체를 안다. */
export interface UpdateIssueStatusVars {
  number: number;
  to: ProjectStatus;
}

/**
 * 서버로 보낼 본문 — 상태 id 가 있으면 그것만(서버는 statusId 를 범주보다 우선한다), 없으면 범주(그 범주의 기본 상태로 간다).
 * 단건 변경은 늘 상태 id 를, 일괄 바(범주만 고름)는 범주를 보낸다.
 */
export function statusRequestBody(category: IssueStatus, statusId?: number): IssueStatusUpdateBody {
  return statusId != null ? { statusId } : { status: category };
}

/**
 * 검색 캐시 낙관적 패치 — 범주·상태 id·이름을 함께 덮는다.
 * 보드는 모든 컬럼 쿼리를 합친 뒤 이슈 필드로 다시 나누므로(IssueBoardView), 제자리 패치만으로 카드가 대상 컬럼으로 바로 옮겨 간다.
 */
export function statusCachePatch(to: ProjectStatus): Partial<IssueResponse> {
  return { status: to.category, statusId: to.id, statusName: to.name };
}

export function useUpdateIssueStatus(projectKey: string, closedHiding?: ClosedHidingNotice) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ number, to }: UpdateIssueStatusVars) =>
      updateIssueStatus(projectKey, number, statusRequestBody(to.category, to.id)),
    // 진행 중인 검색 쿼리 취소 + 스냅샷 + 패치를 공용 헬퍼로 — 실패 시 restore() 로 되돌린다.
    // 보드 새 열 캐시에도 카드를 넣는다 — 이유는 copyIssueIntoStatusColumn(WP-860).
    onMutate: async ({ number, to }) => {
      const ctx = await patchIssueInSearchCache(qc, projectKey, number, statusCachePatch(to));
      copyIssueIntoStatusColumn(qc, projectKey, number, to.id);
      return ctx;
    },
    onError: (err, _vars, ctx) => {
      ctx?.restore();
      handleApiError(err, '태스크 상태 변경에 실패했습니다');
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
    },
    onSuccess: (_res, { number, to }) => {
      void toastStatusChange(projectKey, [number], to.category, closedHiding, 'success', '상태를 변경했습니다');
    },
  });
}
