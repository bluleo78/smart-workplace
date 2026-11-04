// 통합 검색 팔레트(WP-1353)의 조회 묶음 — 종류 탭은 한 앱을 20건씩 무한 조회, 「전체」 탭은 앱마다 3건씩 따로 조회한다.
// 앱마다 따로 부르므로 한 앱이 실패해도 다른 앱 묶음은 그대로 보인다(그 쿼리만 isError).
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'

import type { SearchAppId, SearchTabId } from './searchApps'
import { SEARCH_PROVIDERS,type SearchHit, type SearchPage } from './searchProviders'
import { GROUP_SIZE, SEARCH_PAGE_SIZE } from './searchRules'

const STALE_MS = 30_000

/**
 * tab 이 앱 하나면 그 앱을 무한 조회, 'all' 이면 order 순서대로 앱마다 상위 GROUP_SIZE 건을 조회한다.
 * enabled 는 「검색할 만한 검색어」일 때만 true — 아니면 아무것도 부르지 않는다.
 */
export function useSearchQueries(tab: SearchTabId, term: string, enabled: boolean, order: SearchAppId[]) {
  const kindApp: SearchAppId = tab === 'all' ? order[0] : tab
  const kind = useInfiniteQuery({
    queryKey: ['global-search', kindApp, term],
    queryFn: ({ pageParam, signal }) => SEARCH_PROVIDERS[kindApp].fetchPage(term, pageParam, SEARCH_PAGE_SIZE, signal),
    initialPageParam: null as unknown,
    getNextPageParam: (last: SearchPage) => last.next,
    enabled: enabled && tab !== 'all',
    staleTime: STALE_MS,
  })
  const groups = useQueries({
    queries: order.map((app) => ({
      queryKey: ['global-search', app, term, 'top'],
      queryFn: ({ signal }: { signal: AbortSignal }) => SEARCH_PROVIDERS[app].fetchPage(term, null, GROUP_SIZE + 1, signal),
      enabled: enabled && tab === 'all',
      staleTime: STALE_MS,
    })),
  })

  // 묶음은 GROUP_SIZE+1 건을 받아 3건만 보이고, 4번째가 있으면(또는 next) 「더 보기」를 낸다 — 딱 3건이면 더 볼 것이 없다.
  /** 키보드로 오갈 수 있는 보이는 줄 전체(묶음 넘어, 화면 순서). */
  const visible: SearchHit[] =
    tab === 'all'
      ? groups.flatMap((g) => g.data?.hits.slice(0, GROUP_SIZE) ?? [])
      : (kind.data?.pages.flatMap((p) => p.hits) ?? [])
  const fetching = tab === 'all' ? groups.some((g) => g.isFetching) : kind.isFetching && !kind.isFetchingNextPage

  return { kind, groups, visible, fetching }
}
