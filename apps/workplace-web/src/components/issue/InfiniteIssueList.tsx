// 무한스크롤 이슈 목록 — useInfiniteQuery 결과를 받아 테이블 + sentinel 렌더(내 작업 탭들이 공유).
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'

import { LoadMoreFooter } from '@/components/ui/load-more-footer'

import type { IssueSearchResponse } from '../../types/issue'
import { IssueListTable } from './IssueListTable'

export function InfiniteIssueList({
  query,
  rowTestIdPrefix,
  emptyText,
}: {
  query: UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>
  rowTestIdPrefix: string
  // 빈 상태 제목 — 아이콘(ClipboardList)과 함께 표시.
  emptyText: string
}) {
  const { data, hasNextPage, isFetching, isLoading } = query

  const items = data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? []

  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : /* 마지막 페이지까지 로드 후에만 빈 상태 표시 — 스트리밍 중 깜빡임 방지 */
      items.length === 0 && !hasNextPage && !isFetching ? (
        // 빈 상태 — 아이콘+제목 구조로 맥락 제공(DS §2.5). IssueListWidget 빈 상태와 시각 정합.
        <div
          className="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid={`${rowTestIdPrefix}-empty`}
        >
          <ClipboardList className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">{emptyText}</p>
        </div>
      ) : (
        <IssueListTable items={items} rowTestIdPrefix={rowTestIdPrefix} />
      )}
      {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter, WP-183) */}
      <LoadMoreFooter query={query} data-testid={`${rowTestIdPrefix}-more`} />
    </div>
  )
}
