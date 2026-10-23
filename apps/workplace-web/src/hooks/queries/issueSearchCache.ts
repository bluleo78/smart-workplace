// 이슈 검색 캐시(['issues','search',projectKey] prefix — 보드 컬럼·목록·에픽 패널 공통) 낙관적 패치 공용 헬퍼.
// 왜: 상태 변경·에픽 이동 mutation 이 같은 「취소 → 스냅샷 → 패치 → 실패 시 복원」 흐름을 각자 복제하고 있었다.
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { IssueFilters, IssueResponse, IssueSearchResponse } from '../../types/issue';
import { BOARD_COLUMN_PAGE_SIZE } from './useIssueBoardColumns';
import { issueSearchKey } from './useIssueSearch';

// 한 검색 캐시(여러 페이지)에서 number 이슈를 찾는다 — 아래 헬퍼들이 같은 탐색을 나눠 쓴다.
function findInPages(data: InfiniteData<IssueSearchResponse> | undefined, number: number): IssueResponse | undefined {
  for (const page of data?.pages ?? []) {
    const hit = (page.items ?? []).find((it) => it.number === number);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 검색 캐시 전체에서 number 이슈에 patch 를 덮어쓰고, 실패 시 되돌릴 restore() 를 돌려준다.
 * - 진행 중인 검색 쿼리를 먼저 취소해 늦게 도착한 응답이 낙관적 값을 덮어쓰지 않게 한다.
 * - 해당 이슈가 없는 쿼리는 old 를 그대로 돌려줘 무관한 구독자가 다시 렌더링되지 않게 한다.
 */
export async function patchIssueInSearchCache(
  qc: QueryClient,
  projectKey: string,
  number: number,
  patch: Partial<IssueResponse>,
): Promise<{ restore: () => void }> {
  const queryKey = ['issues', 'search', projectKey];
  await qc.cancelQueries({ queryKey });
  const snapshots = qc.getQueriesData<InfiniteData<IssueSearchResponse>>({ queryKey });
  qc.setQueriesData<InfiniteData<IssueSearchResponse>>({ queryKey }, (old) => {
    if (!old?.pages) return old;
    if (!findInPages(old, number)) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        items: (p.items ?? []).map((it) => (it.number === number ? { ...it, ...patch } : it)),
      })),
    };
  });
  return {
    // 낙관적 패치를 모두 스냅샷으로 되돌린다.
    restore: () => snapshots.forEach(([key, data]) => qc.setQueryData(key, data)),
  };
}

/**
 * 검색 캐시 어디서든 number 이슈의 현재 캐시본을 찾아 돌려준다(없으면 undefined).
 * 왜: 되돌리기 토스트가 클릭 시점의 실제 부모를 확인해, 그 사이 다시 옮겨진 이슈를 옛 값으로 덮지 않게 하기 위함.
 * 캐시가 비워졌을 수 있으므로 호출부는 undefined 를 "알 수 없음"으로 다뤄야 한다.
 */
export function findIssueInSearchCache(qc: QueryClient, projectKey: string, number: number): IssueResponse | undefined {
  const all = qc.getQueriesData<InfiniteData<IssueSearchResponse>>({ queryKey: ['issues', 'search', projectKey] });
  for (const [, data] of all) {
    const hit = findInPages(data, number);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 보드 상태 열(한 상태로 좁힌 열 크기 검색 쿼리)에 있는 number 이슈를, 같은 필터·크기의 대상 열 캐시 맨 앞에도 넣는다(WP-860).
 * 왜: 상태 보드는 열마다 따로 쿼리한다. 낙관적 패치는 원래 열 캐시 안에서 상태만 바꾸므로, 무효화 뒤 원래 열 응답(카드 없음)이
 *     새 열 응답보다 먼저 오면 그 사이 두 캐시 어디에도 카드가 없어 깜빡인다. 새 열 캐시에 미리 넣어 두면 응답 순서와 상관없다
 *     (보드는 id 로 중복을 걷어 낸다). 새 열 캐시가 없거나·화면에 안 쓰이거나(무효화가 재조회하지 않아 넣은 카드가 남는다)
 *     이미 카드가 있으면 그대로 둔다 — 재조회가 서버 순서로 바로잡는다.
 * 보드 열은 프로젝트 상태 하나로 좁힌 쿼리(statusIds=[id], WP-808)다 — 대상 상태 id 로 대상 열 키를 만든다.
 * 호출부는 patchIssueInSearchCache 뒤에 부른다 — 그 스냅샷에 새 열 캐시도 들어 있어 restore() 가 이것까지 되돌린다.
 */
export function copyIssueIntoStatusColumn(
  qc: QueryClient,
  projectKey: string,
  number: number,
  targetStatusId: number,
) {
  const all = qc.getQueriesData<InfiniteData<IssueSearchResponse>>({ queryKey: ['issues', 'search', projectKey] });
  for (const [key, data] of all) {
    // 보드 열 키 모양 ['issues','search',pk, filters, BOARD_COLUMN_PAGE_SIZE] 이고 한 상태로 좁힌 쿼리만 원본으로 본다(목록 뷰 제외).
    const [, , , filters, size] = key as [string, string, string, IssueFilters | undefined, unknown];
    if (size !== BOARD_COLUMN_PAGE_SIZE || !filters) continue;
    // 한 상태로 좁힌 열이 아니거나 이미 대상 열이면 건너뛴다.
    if (filters.statusIds?.length !== 1 || filters.statusIds[0] === targetStatusId) continue;
    const targetFilters = { ...filters, statusIds: [targetStatusId] };
    const issue = findInPages(data, number);
    if (!issue) continue;
    const targetKey = issueSearchKey(projectKey, targetFilters, size);
    if (!qc.getQueryCache().find({ queryKey: targetKey, exact: true })?.isActive()) continue;
    qc.setQueryData<InfiniteData<IssueSearchResponse>>(targetKey, (old) => {
      if (!old?.pages?.length || findInPages(old, number)) return old;
      const [first, ...rest] = old.pages;
      return { ...old, pages: [{ ...first, items: [issue, ...(first.items ?? [])] }, ...rest] };
    });
  }
}
