// 에픽 필터 훅 — URL(parent/topLevel) 읽기·쓰기와 본문 검색 무효화를 한 곳에서. 다른 필터·뷰·group 원값(#878)은 보존한다.
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { currentEpicChoice, type EpicScopeChoice, nextEpicScope } from '../../../lib/epicScope';
import { filtersToParams, parseFilters, parseGroupParam, parseView } from '../../../lib/issueFilters';

export function useEpicFilter(projectKey: string) {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const filters = parseFilters(params);
  const choice = currentEpicChoice(filters);

  /** 선택지 적용 — 해제 전환이면 같은 queryKey 캐시를 무효화해 최신 목록을 즉시 다시 받는다(staleTime 30s 우회). */
  function select(c: EpicScopeChoice) {
    const { parentNumber, topLevel, invalidate } = nextEpicScope(filters, c);
    setParams(filtersToParams({ ...filters, parentNumber, topLevel }, parseView(params), parseGroupParam(params)), { replace: true });
    if (invalidate) queryClient.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
  }

  return { choice, select };
}
