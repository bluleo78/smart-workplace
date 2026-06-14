// 무한스크롤 이슈 목록 — useInfiniteQuery 결과를 받아 테이블 + sentinel 렌더.
// filter 를 주면 페이지 합본에 클라이언트 필터 적용(AI 위임 작업: assignee.kind==='AGENT').
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { ClipboardList, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { IssueResponse, IssueSearchResponse } from '../../types/issue'
import { IssueListTable } from './IssueListTable'

export function InfiniteIssueList({
  query,
  rowTestIdPrefix,
  emptyText,
  emptyIcon: EmptyIcon = ClipboardList,
  emptyDescription,
  filter,
  showAssignees,
}: {
  query: UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>
  rowTestIdPrefix: string
  // 빈 상태 제목(필수) — 기본 아이콘(ClipboardList)으로 모든 사용처에서 3요소 미만은 발생하지 않는다.
  emptyText: string
  // 빈 상태 아이콘 — 사용처별 맥락에 맞게 주입(미지정 시 ClipboardList).
  emptyIcon?: LucideIcon
  // 빈 상태 설명(선택) — 주입 시 [아이콘+제목+설명] 3요소 완성(DS §2.5).
  emptyDescription?: string
  filter?: (it: IssueResponse) => boolean
  // 담당자 컬럼 표시 여부 — AI 위임 페이지(opt-in)만 켜고, 내 작업 뷰는 기본 off(IssueListTable 기본값).
  showAssignees?: boolean
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
        // 빈 상태 — 아이콘+제목(+선택 설명) 구조로 맥락 제공(DS §2.5). IssueListWidget 빈 상태와 시각 정합.
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid={`${rowTestIdPrefix}-empty`}
        >
          <EmptyIcon className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">{emptyText}</p>
          {emptyDescription && (
            <p className="max-w-xs text-xs text-muted-foreground">{emptyDescription}</p>
          )}
        </div>
      ) : (
        <IssueListTable
          items={items}
          rowTestIdPrefix={rowTestIdPrefix}
          showAssignees={showAssignees}
        />
      )}
      <div ref={sentinel} aria-hidden="true" className="h-1" />
      {isFetching && !isLoading && <p className="text-muted-foreground py-2">불러오는 중…</p>}
    </div>
  )
}
