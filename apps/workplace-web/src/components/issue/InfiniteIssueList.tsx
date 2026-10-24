// 무한스크롤 이슈 목록 — useInfiniteQuery 결과를 받아 테이블 + sentinel 렌더(내 작업 탭들이 공유).
// 상태 화면을 서로 다르게 보인다(WP-916, 프로젝트 목록 IssueListView 와 같은 분기 순서):
// 실패(빈 상태로 오해하지 않게) → 로딩(스켈레톤) → 필터 0건(+필터 초기화) → 데이터 없음(+다음 행동) → 목록.
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query'
import { ClipboardList, SearchX } from 'lucide-react'

import { LoadErrorState } from '@/components/LoadErrorState'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { failedWithoutData } from '@/lib/queryFailure'

import type { IssueSearchResponse } from '../../types/issue'
import { IssueListTable } from './IssueListTable'
import { ListEmptyState } from './ListEmptyState'
import { ListLoadingSkeleton } from './ListLoadingSkeleton'

/** 빈 상태 다음 행동 버튼 — testId 는 목록 접두어로 붙인다. */
type EmptyAction = { label: string; onClick: () => void; testIdSuffix: string }

export function InfiniteIssueList({
  query,
  rowTestIdPrefix,
  showAssignee,
  empty,
  filtered,
  filteredDescription,
  onResetFilters,
  scrollRoot = null,
}: {
  query: UseInfiniteQueryResult<InfiniteData<IssueSearchResponse>, Error>
  rowTestIdPrefix: string
  /** 담당자 열 — 할당 탭은 내가 맡은 일이라 false, 내가 만든·구독 탭은 true(WP-916). */
  showAssignee: boolean
  /** 데이터 없음 안내 — 필터가 없을 때. action 으로 다음 행동(예: 「완료 모두 보기」)을 준다. */
  empty: { title: string; description?: string; action?: EmptyAction }
  /** 필터(상태 범주·우선순위 등)가 걸려 있으면 필터 0건 화면 + 초기화 */
  filtered: boolean
  /** 필터 0건 설명 — 탭마다 무엇이 걸러졌는지(「할당된 작업은 있지만…」). 필터를 거는 탭은 늘 넘긴다(필터 없는 탭은 쓰지 않음). */
  filteredDescription?: string
  onResetFilters?: () => void
  /** 목록을 감싼 스크롤 요소(Page.Body) — 무한 로드 sentinel 의 root(DS 05 §A-3). 뷰포트로 두면 선행 로드 여유가 스크롤 클리핑에 먹혀 끝에 닿아야 불러온다. */
  scrollRoot?: Element | null
}) {
  const { data, hasNextPage, isFetching, isLoading } = query

  const items = data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? []

  let body
  if (failedWithoutData(query)) {
    // 첫 페이지 실패 — 빈 상태가 아니라 실패로 알린다(다음 페이지 실패는 LoadMoreFooter 가 맡는다).
    // isLoading 보다 먼저 본다 — 다시 시도로 부르는 동안(pending)에도 안내를 두어 키보드 초점을 지킨다(WP-893).
    body = (
      <LoadErrorState
        title="작업을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        queries={[query]}
        testId={`${rowTestIdPrefix}-error`}
      />
    )
  } else if (isLoading) {
    // 로딩 — 스켈레톤(DS 06 §A-2). 데스크톱은 표 자리, 모바일은 2줄 행 모양(ListLoadingSkeleton).
    body = <ListLoadingSkeleton label="작업 불러오는 중" />
  } else if (items.length === 0 && !hasNextPage && !isFetching) {
    // 마지막 페이지까지 받은 뒤에만 빈 상태 — 스트리밍 중 깜빡임 방지.
    // 필터가 걸렸으면 「데이터 없음」과 구분해 초기화를 준다(DS 06 §B).
    const emptyTid = `${rowTestIdPrefix}-empty`
    body = filtered ? (
      <ListEmptyState
        icon={SearchX}
        title="조건에 맞는 작업이 없습니다"
        description={filteredDescription}
        action={onResetFilters && { label: '필터 초기화', onClick: onResetFilters, testId: `${emptyTid}-reset` }}
        testId={emptyTid}
      />
    ) : (
      <ListEmptyState
        icon={ClipboardList}
        title={empty.title}
        description={empty.description}
        action={empty.action && { label: empty.action.label, onClick: empty.action.onClick, testId: `${emptyTid}-${empty.action.testIdSuffix}` }}
        testId={emptyTid}
      />
    )
  } else {
    body = <IssueListTable items={items} rowTestIdPrefix={rowTestIdPrefix} showAssignee={showAssignee} />
  }

  return (
    <div className="space-y-4">
      {body}
      {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter, WP-183) */}
      <LoadMoreFooter query={query} root={scrollRoot} data-testid={`${rowTestIdPrefix}-more`} />
    </div>
  )
}
