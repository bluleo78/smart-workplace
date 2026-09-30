// 이슈 목록 사이클 구간 쿼리(#878) — 구간(사이클 / 백로그)마다 독립 무한 스크롤 쿼리.
// useIssueSearch 를 그대로 써 키가 ['issues','search',projectKey,…] 하위 — 이슈 변경·사이클 피커·SSE 무효화에 함께 걸린다.

import type { IssueFilters } from '../../types/issue';
import type { BoardColumnQuery } from './useIssueBoardColumns';
import { useIssueSearch } from './useIssueSearch';

// 구간당 한 페이지 크기 — 보드 컬럼(BOARD_COLUMN_PAGE_SIZE)과 같은 기준.
const CYCLE_SECTION_PAGE_SIZE = 50;

/**
 * 구간 이슈 쿼리 — 펼친 구간만 요청한다.
 * 왜 undefined 반환: 접힌 구간도 훅은 호출되는데, 같은 키의 비활성 observer 는 캐시 data·hasNextPage 를 그대로 돌려준다(#875).
 * 다시 접은 구간에 옛 건수·행·sentinel 이 새지 않도록 비활성이면 결과를 버린다(useIssueBoardColumns 의 슬롯과 같은 규칙).
 */
export function useCycleSectionIssues(
  projectKey: string,
  filters: IssueFilters,
  expanded: boolean,
): BoardColumnQuery | undefined {
  const query = useIssueSearch(projectKey, filters, CYCLE_SECTION_PAGE_SIZE, expanded);
  return expanded ? query : undefined;
}
