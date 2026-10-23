// 에픽 필터 훅 — URL(parent/topLevel) 읽기·쓰기와 본문 검색 무효화를 한 곳에서. 다른 필터·뷰·group 원값(#878)은 보존한다.
// 종료된 에픽으로 들어가고 나올 때 「완료 모두 보기」(closed=all)도 함께 켜고 끈다(WP-390, nextShowAllClosed).
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { currentEpicChoice, type EpicScopeChoice, nextEpicScope, nextShowAllClosed } from '../../../lib/epicScope';
import { carryViewOptions, filtersToParams, parseFilters, parseGroupParam, parseView } from '../../../lib/issueFilters';
import type { IssueResponse } from '../../../types/issue';

// closedEpics: 「종료된 에픽」 목록 — 종료된 에픽으로 들어가고 나오는지 판정한다. 패널·시트가 이미 받아 둔 목록을 넘겨
// 이 훅이 따로 조회하지 않게 한다(모바일 시트의 지연 조회 규칙 유지).
export function useEpicFilter(projectKey: string, closedEpics: readonly Pick<IssueResponse, 'number'>[]) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const filters = parseFilters(params);
  const choice = currentEpicChoice(filters);

  /** 선택지 적용 — 해제 전환이면 같은 queryKey 캐시를 무효화해 최신 목록을 즉시 다시 받는다(staleTime 30s 우회). */
  function select(c: EpicScopeChoice) {
    const { parentNumber, topLevel, invalidate } = nextEpicScope(filters, c);
    const showAllClosed = nextShowAllClosed(filters, parentNumber, (n) => closedEpics.some((e) => e.number === n));
    setParams((prev) => carryViewOptions(filtersToParams({ ...filters, parentNumber, topLevel, showAllClosed }, parseView(prev), parseGroupParam(prev)), prev), { replace: true });
    if (invalidate) queryClient.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
  }

  return { choice, select };
}
