// 무한스크롤 이슈 목록 — useInfiniteQuery 결과를 받아 테이블 + sentinel 렌더.
// filter 를 주면 페이지 합본에 클라이언트 필터 적용(AI 위임 작업: assignee.kind==='AGENT').
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import type { IssueResponse, IssueSearchResponse } from '../../types/issue'
import { IssueListTable } from './IssueListTable'

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
      ) : /* 마지막 페이지까지 로드 후에만 빈 상태 표시 — 스트리밍 중 깜빡임 방지 */
      items.length === 0 && !hasNextPage && !isFetching ? (
        <p className="text-muted-foreground py-8 text-center">{emptyText}</p>
      ) : (
        <IssueListTable items={items} rowTestIdPrefix={rowTestIdPrefix} />
      )}
      <div ref={sentinel} aria-hidden="true" className="h-1" />
      {isFetching && !isLoading && <p className="text-muted-foreground py-2">불러오는 중…</p>}
    </div>
  )
}
