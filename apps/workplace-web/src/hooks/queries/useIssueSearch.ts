// 이슈 검색/필터 — cursor 기반 무한 스크롤.
// list 뷰와 board 뷰가 동일한 쿼리 키를 공유해 캐시를 재사용한다.

import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';

import { searchIssues } from '../../api/issues';
import type { IssueFilters } from '../../types/issue';

// queryKey 는 ['issues', 'search', projectKey, filters, size] — URL 이 바뀌면 자동으로 재실행된다.
// pageParam 은 nextCursor 문자열(또는 null) 이며 백엔드가 base64url 로 인코딩한 불투명 토큰이다.
// enabled 는 호출자가 (필터 준비 등) 추가 조건으로 실제 네트워크 요청을 막고 싶을 때 사용한다.
/** 이슈 검색 쿼리 키 — 훅과 낙관적 캐시 패치(사이클 구간 드래그 이동 등)가 같은 키를 짚도록 한 곳에서 만든다. */
export function issueSearchKey(projectKey: string, filters: IssueFilters, size: number) {
  return ['issues', 'search', projectKey, filters, size] as const;
}

/**
 * 이슈 검색 무한 쿼리 옵션 — useIssueSearch 와 보드 컬럼 관찰자(useIssueBoardColumns)가 같은 키·페이지 규칙을 쓰도록 모은다.
 * 키가 갈라지면 낙관적 패치(patchIssueInSearchCache)·무효화가 보드 컬럼 캐시를 놓친다.
 */
export function issueSearchOptions(projectKey: string, filters: IssueFilters, size = 30, enabled = true) {
  return infiniteQueryOptions({
    queryKey: issueSearchKey(projectKey, filters, size),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => searchIssues(projectKey, filters, pageParam, size),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!projectKey && enabled,
  });
}

export function useIssueSearch(
  projectKey: string,
  filters: IssueFilters,
  size = 30,
  enabled = true,
) {
  return useInfiniteQuery(issueSearchOptions(projectKey, filters, size, enabled));
}
