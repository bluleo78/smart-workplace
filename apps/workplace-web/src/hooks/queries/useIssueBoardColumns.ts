// 보드 상태 컬럼별 무한 스크롤 쿼리 (#875).
// 왜: 보드 전체를 하나의 쿼리로 받으면 페이지가 정렬 순서대로 섞여 와서, 특정 컬럼의 카드가
//     뒤 페이지에 있을 때 그 컬럼만 조용히 비어 보인다(기존 200건 상한). 컬럼마다 status 로 좁힌
//     독립 쿼리를 두면 각 컬럼이 자기 끝까지 스크롤하며 다음 페이지를 이어 받을 수 있다.

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import type { IssueFilters, IssueSearchResponse } from '../../types/issue';
import { useIssueSearch } from './useIssueSearch';

// 컬럼당 한 페이지 크기 — 4컬럼 첫 렌더가 200장을 넘지 않도록 50.
export const BOARD_COLUMN_PAGE_SIZE = 50;

export type BoardColumnQuery = UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>;

// 컬럼 status 에 맞춘 필터를 만든다.
// - 사용자 상태 필터가 없거나 이 status 를 포함하면 statuses=[status] 로 좁힌다.
// - 사용자 상태 필터가 이 status 를 제외하면 null(쿼리 비활성) — statuses=[] 로 흘리면 API 가 "전체 상태"로 해석해
//   다른 상태 카드가 이 컬럼에 섞인다.
function columnFilters(filters: IssueFilters, status: string | undefined): IssueFilters | null {
  if (!status) return null;
  if (filters.statuses.length > 0 && !filters.statuses.includes(status)) return null;
  return { ...filters, statuses: [status] };
}

// 슬롯 하나 — status 가 없거나 필터로 제외되면 비활성이고 결과는 undefined.
// 왜 undefined: 비활성 슬롯도 훅은 호출되는데, 그 키(원본 filters)가 단일 상태 필터일 때 활성 컬럼 키와 같아져
// 비활성 observer 가 그 컬럼의 data·hasNextPage 를 그대로 돌려준다 → 제외 컬럼에 "0+"·sentinel 이 새지 않도록 버린다.
function useColumnSlot(
  projectKey: string,
  filters: IssueFilters,
  status: string | undefined,
  enabled: boolean,
): BoardColumnQuery | undefined {
  const f = columnFilters(filters, status);
  const active = enabled && f != null;
  const query = useIssueSearch(projectKey, f ?? filters, BOARD_COLUMN_PAGE_SIZE, active);
  return active ? query : undefined;
}

/**
 * 컬럼 status 목록 순서대로 쿼리 결과를 돌려준다(status → query).
 * enabled=false 이면(담당자·우선순위 그룹 보드) 모든 컬럼 쿼리를 끈다. 비활성 컬럼은 맵에 없다.
 */
export function useIssueBoardColumns(
  projectKey: string,
  filters: IssueFilters,
  statuses: string[],
  enabled = true,
): Record<string, BoardColumnQuery | undefined> {
  // 훅 규칙상 반복문 대신 고정 슬롯 4개(팀 4 · 개인 3 컬럼)를 펼쳐 호출한다 — 5번째 컬럼은 쿼리되지 않는다.
  const q0 = useColumnSlot(projectKey, filters, statuses[0], enabled);
  const q1 = useColumnSlot(projectKey, filters, statuses[1], enabled);
  const q2 = useColumnSlot(projectKey, filters, statuses[2], enabled);
  const q3 = useColumnSlot(projectKey, filters, statuses[3], enabled);
  const slots = [q0, q1, q2, q3];
  const result: Record<string, BoardColumnQuery | undefined> = {};
  statuses.forEach((s, i) => {
    result[s] = slots[i];
  });
  return result;
}
