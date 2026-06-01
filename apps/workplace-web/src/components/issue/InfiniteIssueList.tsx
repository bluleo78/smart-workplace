// 무한스크롤 이슈 목록 — useInfiniteQuery 결과를 받아 테이블 + sentinel 렌더.
// filter 를 주면 페이지 합본에 클라이언트 필터 적용(AI 위임 작업: assignee.kind==='AGENT').
import { useEffect, useRef } from 'react'
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'

import { IssueListTable } from './IssueListTable'
import type { IssueResponse, IssueSearchResponse } from '../../types/issue'

export function InfiniteIssueList({
  query,
  rowTestIdPrefix,
  emptyText,
  filter,
}: {
  query: UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>
  rowTestIdPrefix: string
  emptyText: string
  filter?: (it: IssueResponse) => boolean
}) {
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } = query
  const sentinel = useRef<HTMLDivElement | null>(null)

  // sentinel 진입 → 다음 페이지 자동 fetch.
  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const io = new IntersectionObserver(
      (es) => {
        if (es[0]?.isIntersecting && hasNextPage && !isFetching) void fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [hasNextPage, isFetching, fetchNextPage])

  let items = data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? []
  if (filter) items = items.filter(filter)

  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">{emptyText}</p>
      ) : (
        <IssueListTable items={items} rowTestIdPrefix={rowTestIdPrefix} />
      )}
      <div ref={sentinel} aria-hidden="true" className="h-1" />
      {isFetching && !isLoading && <p className="text-muted-foreground py-2">불러오는 중…</p>}
    </div>
  )
}
