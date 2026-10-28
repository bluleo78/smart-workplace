// 이슈 검색/필터 — cursor 기반 무한 스크롤.
// list 뷰와 board 뷰가 동일한 쿼리 키를 공유해 캐시를 재사용한다.

import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/react-query';

import { searchIssues } from '../../api/issues';
import type { IssueFilters } from '../../types/issue';
import { refreshStatusesOnUnknown } from './useProjectStatuses';

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
 * extra(필터 밖 추가 파라미터, 예: 개인 목록 checklist 정렬)는 있을 때만 키 끝에 붙인다 — 없으면 기존 키 그대로라
 * 낙관적 패치·무효화 경로가 바뀌지 않는다. 있으면 접두 ['issues','search',projectKey] 가 같아 무효화는 그대로 닿는다.
 * 커서가 extra 를 담지 않으므로(서버 checklist 커서 c1) extra 가 바뀌면 키가 바뀌어 1페이지부터 다시 받아야 한다.
 */
export function issueSearchOptions(
  projectKey: string,
  filters: IssueFilters,
  size = 30,
  enabled = true,
  extra?: Record<string, string>,
) {
  const baseKey = issueSearchKey(projectKey, filters, size);
  return infiniteQueryOptions({
    queryKey: extra ? ([...baseKey, extra] as const) : baseKey,
    initialPageParam: null as string | null,
    // 응답에 모르는 상태(방금 다른 사용자가 만든 상태)가 있으면 상태 목록을 한 번 다시 받는다(WP-808) — 보드 컬럼·목록 버킷이 생긴다.
    // extra 는 키를 만든 그 값(클로저)을 쓴다 — 여기서 날짜를 다시 계산하면 키와 요청이 어긋난다.
    queryFn: async ({ pageParam, client }) => {
      const page = await searchIssues(projectKey, filters, pageParam, size, extra);
      refreshStatusesOnUnknown(client, projectKey, page.items ?? []);
      return page;
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!projectKey && enabled,
  });
}

export function useIssueSearch(
  projectKey: string,
  filters: IssueFilters,
  size = 30,
  enabled = true,
  extra?: Record<string, string>,
) {
  return useInfiniteQuery(issueSearchOptions(projectKey, filters, size, enabled, extra));
}

/**
 * 자리채움 규칙 — 같은 프로젝트 안에서 조건(키)만 바뀌면 새 결과가 올 때까지 이전 결과를 둔다(WP-1049).
 * 키 셋째 칸이 프로젝트 키인 검색 캐시(['issues','search',projectKey,…])에 쓴다. 다른 프로젝트로 옮기면 남기지 않는다 —
 * 그 프로젝트의 이슈가 잠깐이라도 보이면 안 된다. 화면은 isPlaceholderData 로 흐림(RefreshingResults)을 건다.
 */
export function keepPreviousInProject<T>(projectKey: string) {
  return (previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery?.queryKey[2] === projectKey ? previous : undefined;
}

/**
 * 작업 관리 목록처럼 저장한 뷰·필터를 오가며 보는 화면의 검색 — 조건을 바꾸면 이전 목록을 둔 채 새 결과를 받아
 * 한 번에 바꾼다(WP-1049). 스켈레톤은 처음 열 때만 보인다.
 */
export function useIssueSearchKeepingPrevious(projectKey: string, filters: IssueFilters, size = 30, enabled = true) {
  return useInfiniteQuery({
    ...issueSearchOptions(projectKey, filters, size, enabled),
    placeholderData: keepPreviousInProject(projectKey),
  });
}
