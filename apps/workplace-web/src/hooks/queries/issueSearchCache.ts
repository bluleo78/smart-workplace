// 이슈 검색 캐시(['issues','search',projectKey] prefix — 보드 컬럼·목록·에픽 패널 공통) 낙관적 패치 공용 헬퍼.
// 왜: 상태 변경·에픽 이동 mutation 이 같은 「취소 → 스냅샷 → 패치 → 실패 시 복원」 흐름을 각자 복제하고 있었다.
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { IssueResponse, IssueSearchResponse } from '../../types/issue';

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
    const contains = old.pages.some((p) => (p.items ?? []).some((it) => it.number === number));
    if (!contains) return old;
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
    for (const page of data?.pages ?? []) {
      const hit = (page.items ?? []).find((it) => it.number === number);
      if (hit) return hit;
    }
  }
  return undefined;
}
