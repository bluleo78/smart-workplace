// 앱 하나를 고른 탭의 결과 목록(WP-1353) — 20건씩 무한 스크롤(스크롤이 끝에 닿으면 다음 쪽, ↓ 가 마지막에 닿아도 다음 쪽은 팔레트가 부른다).
// 지금 앱 탭이면 목록 끝에 「다른 앱에서도 찾기 → 전체」, 0건이면 빈 문구 + 「모든 앱에서 찾기 → 전체」.
import type { UseInfiniteQueryResult } from '@tanstack/react-query'
import { type UIEvent, useEffect, useRef } from 'react'

import { SEARCH_TABS, type SearchAppId } from './searchApps'
import type { SearchHit, SearchPage } from './searchProviders'
import { RetryNotice, RowSkeletons } from './SearchStates'

/** 스크롤 바닥까지 남은 거리(px)가 이보다 작으면 다음 쪽을 받는다. */
const NEAR_BOTTOM_PX = 80

interface Props {
  app: SearchAppId
  term: string
  /** 지금 화면이 속한 앱 — 같으면 끝에 「다른 앱에서도 찾기」를 보인다. */
  current: SearchAppId | null
  query: UseInfiniteQueryResult<{ pages: SearchPage[] }, Error>
  hits: SearchHit[]
  rowFor: (hit: SearchHit) => React.ReactNode
  onGoAll: () => void
}

export function SearchKindResults({ app, term, current, query, hits, rowFor, onGoAll }: Props) {
  const label = SEARCH_TABS.find((t) => t.id === app)?.label ?? ''

  const sentinelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  // 목록 끝 sentinel 이 보이면 다음 쪽 — 첫 쪽이 상자를 못 채워 스크롤이 안 생겨도 이어 받는다.
  // 쪽이 늘 때마다 관찰을 새로 시작해(초기 콜백) 새 쪽도 아직 상자를 못 채웠으면 한 번 더 받는다. IntersectionObserver 가 없으면 onScroll 만.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage || isFetchingNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { root: scrollRef.current },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, hits.length])

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage()
    }
  }

  if (query.isPending && !query.isError) return <RowSkeletons count={6} />
  if (query.isError && hits.length === 0) return <RetryNotice testId="global-search-error" onRetry={() => void query.refetch()} />
  if (hits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-2 py-8 text-center text-sm text-muted-foreground" data-testid="global-search-empty">
        <p>
          {label}에 「{term}」와 맞는 것이 없어요
        </p>
        <button type="button" data-testid="global-search-go-all" onClick={onGoAll} className="text-xs text-primary underline hover:no-underline">
          모든 앱에서 찾기 → 전체
        </button>
      </div>
    )
  }
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-1" onScroll={onScroll} data-testid="global-search-scroll">
      <div role="listbox" aria-label={`${label} 검색 결과`}>
        {hits.map((h) => rowFor(h))}
      </div>
      <div ref={sentinelRef} aria-hidden className="h-px" />
      {query.isFetchingNextPage && <RowSkeletons count={2} />}
      {query.isError && <RetryNotice testId="global-search-error" onRetry={() => void query.fetchNextPage()} />}
      {current === app && !query.hasNextPage && (
        <button
          type="button"
          data-testid="global-search-go-all"
          onClick={onGoAll}
          className="mt-1 w-full rounded-md px-2 py-2 text-left text-xs text-primary hover:bg-accent"
        >
          다른 앱에서도 찾기 → 전체
        </button>
      )}
    </div>
  )
}
