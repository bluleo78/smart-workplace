// 통합 검색 팔레트(WP-1353)의 조회 묶음 — 종류 탭은 한 앱을 20건씩 무한 조회, 「전체」 탭은 앱마다 3건씩 따로 조회한다.
// 앱마다 따로 부르므로 한 앱이 실패해도 다른 앱 묶음은 그대로 보인다(그 쿼리만 isError).
import { type QueryClient, useInfiniteQuery, useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useAuth } from '@/hooks/useAuth'

import type { SearchAppId, SearchTabId } from './searchApps'
import { createSearchProviders, dedupeHits, pickGroupHits, type SearchHit, type SearchPage } from './searchProviders'
import { GROUP_SIZE, SEARCH_PAGE_SIZE } from './searchRules'

const STALE_MS = 30_000

/** useQueries 결과를 그대로 돌려주는 combine — 모듈 상수라 결과가 안 바뀌면 같은 배열이 유지돼 아래 useMemo 가 먹는다. */
const keepResults = (results: UseQueryResult<SearchPage, Error>[]) => results

/** provider 를 만드는 의존 — queryClient 는 검색어와 무관한 목록 캐시용, meId 는 DM 이름 파생용. */
function useProviders() {
  const queryClient: QueryClient = useQueryClient()
  const meId = useAuth().user?.id ?? null
  return useMemo(() => createSearchProviders({ queryClient, meId }), [queryClient, meId])
}

/**
 * tab 이 앱 하나면 그 앱을 무한 조회, 'all' 이면 order 순서대로 앱마다 상위 GROUP_SIZE 건을 조회한다.
 * 각 앱은 자기 provider.isSearchable(term) 이 참일 때만 조회한다(한 글자 번호는 이슈만). searchable 은 어느 앱이든 보낼 만한가.
 */
export function useSearchQueries(tab: SearchTabId, term: string, order: SearchAppId[]) {
  const kindApp: SearchAppId = tab === 'all' ? order[0] : tab
  const providers = useProviders()
  const searchable = Object.values(providers).some((p) => p.isSearchable(term))
  const kind = useInfiniteQuery({
    queryKey: ['global-search', kindApp, term],
    queryFn: ({ pageParam, signal }) => providers[kindApp].fetchPage(term, pageParam, SEARCH_PAGE_SIZE, signal),
    initialPageParam: null as unknown,
    getNextPageParam: (last: SearchPage) => last.next,
    enabled: tab !== 'all' && providers[kindApp].isSearchable(term),
    staleTime: STALE_MS,
  })
  const groups = useQueries({
    queries: order.map((app) => ({
      queryKey: ['global-search', app, term, 'top'],
      queryFn: ({ signal }: { signal: AbortSignal }) => providers[app].fetchPage(term, null, GROUP_SIZE + 1, signal),
      enabled: tab === 'all' && providers[app].isSearchable(term),
      staleTime: STALE_MS,
    })),
    combine: keepResults,
  })

  // 묶음은 GROUP_SIZE+1 건을 받아 3건만 보이고, 4번째가 있으면(또는 next) 「더 보기」를 낸다 — 딱 3건이면 더 볼 것이 없다.
  // 키보드로 오갈 수 있는 보이는 줄 전체(묶음 넘어, 화면 순서). 데이터가 안 바뀌면 렌더마다 새로 만들지 않는다.
  const kindData = kind.data
  const visible = useMemo<SearchHit[]>(
    () =>
      tab === 'all'
        ? groups.flatMap((g, i) => pickGroupHits(order[i], dedupeHits(g.data?.hits ?? [])))
        : dedupeHits(kindData?.pages.flatMap((p) => p.hits) ?? []),
    [tab, groups, kindData, order],
  )
  // key → 보이는 줄 인덱스 — 줄마다 findIndex 를 돌리지 않게 visible 이 바뀔 때만 만든다.
  const indexByKey = useMemo(() => new Map(visible.map((v, i) => [v.key, i])), [visible])
  const fetching = tab === 'all' ? groups.some((g) => g.isFetching) : kind.isFetching && !kind.isFetchingNextPage

  return { kind, groups, visible, indexByKey, searchable, fetching }
}
