// 노트 「최근」(WP-1764) cursor 페이징 훅 — useInfiniteQuery.

import { useInfiniteQuery } from '@tanstack/react-query'

import { wikiApi } from '../../api/wiki'
import type { WikiRecentPage } from '../../types/wiki'
import { wikiKeys } from './wikiKeys'

/**
 * 내가 열거나 고친 노트 목록(최근 순, 50개씩) — 아래로 내리면 nextCursor 로 다음 쪽을 받는다.
 * 쪽이 짧아도 nextCursor 가 있으면 계속 받는다(서버가 못 읽는 페이지를 걸러내 쪽이 줄 수 있다).
 * 화면에 들어올 때마다 새로 받는다(refetchOnMount: 'always') — 방금 연 노트가 맨 위에 보이게.
 */
export function useWikiRecent() {
  return useInfiniteQuery<WikiRecentPage>({
    queryKey: wikiKeys.recent(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => wikiApi.recent(pageParam as string | undefined),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
}
