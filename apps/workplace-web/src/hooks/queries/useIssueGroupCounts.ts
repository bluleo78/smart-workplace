// 목록 그룹별 총계(WP-472) — 헤더에 「불러온 행 수」 대신 서버가 같은 필터로 센 정확한 수를 보인다.
import { useQuery } from '@tanstack/react-query';

import { getIssueGroupCounts } from '../../api/issues';
import type { IssueClientGroupBy, IssueCountableGroupBy, IssueFilters, IssueGroupCountsBy } from '../../types/issue';

const COUNTABLE: ReadonlySet<IssueClientGroupBy> = new Set<IssueCountableGroupBy>(['status', 'priority', 'assignee']);

/**
 * 서버에 보낼 그룹 기준 — 셀 수 없는 그룹(에픽·없음)이면 null.
 * 상태 그룹은 프로젝트 상태(statusId)별 버킷이라 총계도 statusId 로 센다(WP-808) — 키가 버킷 key(statusId 문자열)와 같다.
 * 목록은 상태 목록을 받은 뒤에만 그려(ProjectStatusesGate, WP-870) 범주 버킷으로 묶는 때가 없다.
 */
export function groupCountsBy(groupBy: IssueClientGroupBy | null): IssueGroupCountsBy | null {
  if (groupBy === 'status') return 'statusId';
  return groupBy != null && COUNTABLE.has(groupBy) ? (groupBy as IssueCountableGroupBy) : null;
}

/**
 * 키는 검색 캐시 prefix(['issues','search',projectKey]) 아래에 둔다 — 이슈 변경 뒤 검색을 무효화하는 곳들이 총계도 함께 다시 받게.
 * (그 prefix 를 패치하는 낙관적 헬퍼는 pages 가 없는 캐시를 건드리지 않는다.) 에픽 그룹·그룹 없음이면 요청하지 않는다.
 */
export function useIssueGroupCounts(
  projectKey: string,
  filters: IssueFilters,
  groupBy: IssueClientGroupBy | null,
) {
  const serverGroupBy = groupCountsBy(groupBy);
  return useQuery({
    queryKey: groupCountsQueryKey(projectKey, serverGroupBy, filters),
    queryFn: () => getIssueGroupCounts(projectKey, filters, serverGroupBy!),
    enabled: !!projectKey && serverGroupBy != null,
  });
}

/** 총계 캐시 키 — 그룹 헤더 총계와 구간 전체 수(아래)가 같은 키를 써서 같은 필터·기준이면 캐시를 나눈다. */
function groupCountsQueryKey(projectKey: string, by: IssueGroupCountsBy | null, filters: IssueFilters) {
  return ['issues', 'search', projectKey, 'group-counts', by, filters] as const;
}

/**
 * 같은 필터에 맞는 이슈 전체 수(WP-1231) — 목록 구간 끝 「더 보기」에 「전체 N건 중 M건 표시」를 보이려고 쓴다. 전용 총계 API 가 없어 group-counts 를
 * 우선순위로 받아 합한다(0건 그룹은 빠지고 우선순위 없음도 한 그룹이라 합이 전체 수다). 키가 검색 prefix 아래라 이슈 변경 무효화에 함께 걸린다.
 * enabled 가 false 면(구간이 접혔거나 다음 페이지가 없으면) 요청하지 않는다.
 */
export function useIssueTotal(projectKey: string, filters: IssueFilters, enabled: boolean) {
  return useQuery({
    queryKey: groupCountsQueryKey(projectKey, 'priority', filters),
    queryFn: () => getIssueGroupCounts(projectKey, filters, 'priority'),
    select: (res) => res.groups.reduce((sum, g) => sum + g.count, 0),
    enabled: !!projectKey && enabled,
  });
}
