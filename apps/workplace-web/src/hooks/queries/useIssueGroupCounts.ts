// 목록 그룹별 총계(WP-472) — 헤더에 「불러온 행 수」 대신 서버가 같은 필터로 센 정확한 수를 보인다.
import { useQuery } from '@tanstack/react-query';

import { getIssueGroupCounts } from '../../api/issues';
import type { IssueClientGroupBy, IssueCountableGroupBy, IssueFilters, IssueGroupCountsBy } from '../../types/issue';

const COUNTABLE: ReadonlySet<IssueClientGroupBy> = new Set<IssueCountableGroupBy>(['status', 'priority', 'assignee']);

/**
 * 키는 검색 캐시 prefix(['issues','search',projectKey]) 아래에 둔다 — 이슈 변경 뒤 검색을 무효화하는 곳들이 총계도 함께 다시 받게.
 * (그 prefix 를 패치하는 낙관적 헬퍼는 pages 가 없는 캐시를 건드리지 않는다.) 에픽 그룹·그룹 없음이면 요청하지 않는다.
 */
export function useIssueGroupCounts(projectKey: string, filters: IssueFilters, groupBy: IssueClientGroupBy | null) {
  const countable = groupBy != null && COUNTABLE.has(groupBy) ? (groupBy as IssueCountableGroupBy) : null;
  // 상태 그룹은 프로젝트 상태(statusId)별 버킷이라 총계도 statusId 로 센다(WP-808) — 키가 버킷 key(statusId 문자열)와 같다.
  const serverGroupBy: IssueGroupCountsBy | null = countable === 'status' ? 'statusId' : countable;
  return useQuery({
    queryKey: ['issues', 'search', projectKey, 'group-counts', serverGroupBy, filters] as const,
    queryFn: () => getIssueGroupCounts(projectKey, filters, serverGroupBy!),
    enabled: !!projectKey && serverGroupBy != null,
  });
}
