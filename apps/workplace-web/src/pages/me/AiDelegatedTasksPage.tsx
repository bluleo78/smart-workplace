// AI 위임 작업(WP-377) — AI 가 맡았거나 AI 도구로 진행 중인 이슈를 "내가 답하거나 검토할 것" 먼저 보여 주는 분류 화면.
// 조회는 서버 조건(/me/ai-tasks: 범위·AI 진행 상태·facet)이고 정렬도 서버 순서(급한 순) 그대로 쓴다.
// 칩 건수·AI 화면 컨텍스트 건수는 /me/ai-tasks/counts 에서 받는다(로드된 행 수가 아니라 서버 건수).
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { Page } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Button } from '@/components/ui/button'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useAiTaskCounts, useAiTasks } from '@/hooks/queries/useAiTasks'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildAiTasksContext } from '@/lib/aiScreenContext/builders/issue'
import { cn } from '@/lib/utils'

import { aiTaskParams, QUICK_STATE_META } from './aiTasks/aiTaskParams'
import { AiTasksEmptyState } from './aiTasks/AiTasksEmptyState'
import { AiTasksMobileList } from './aiTasks/AiTasksMobileList'
import { AiTasksTable } from './aiTasks/AiTasksTable'
import { AiTasksToolbar } from './aiTasks/AiTasksToolbar'

export default function AiDelegatedTasksPage() {
  const [params] = useSearchParams()
  // facet 은 이 화면이 서버에 실제로 보내는 것(status/priority)만 — 빈 상태 판정·AI 화면 컨텍스트도 같은 값을 쓴다.
  const { list, counts, facets, filtered, scope, state } = useMemo(() => aiTaskParams(params), [params])
  const query = useAiTasks(list)
  const countsQuery = useAiTaskCounts(counts)
  const isMobile = useIsMobile()

  // WP-54: AI 화면 컨텍스트 — 범위·켜진 칩·facet + 보이는 집합의 서버 건수(칩이 켜졌으면 그 칩 건수, 아니면 미완료 all).
  // 건수를 받기 전·이전 조건의 자리채움(keepPreviousData) 값일 땐 생략(현재 조건으로 로드 안 된 값은 보내지 않는다).
  const visibleCount = countsQuery.data && !countsQuery.isPlaceholderData
    ? state
      ? countsQuery.data[QUICK_STATE_META[state].countKey]
      : countsQuery.data.all
    : undefined
  const stateLabel = state ? QUICK_STATE_META[state].label : null
  useRegisterAiScreenContext(
    useMemo(
      () => buildAiTasksContext({ facets, count: visibleCount, scope, stateLabel }),
      [facets, visibleCount, scope, stateLabel],
    ),
  )

  const items = query.data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? []
  // 마지막 페이지까지 받은 뒤에만 빈 상태 — 스트리밍 중 깜빡임 방지(InfiniteIssueList 와 같은 기준).
  const empty = items.length === 0 && !query.hasNextPage && !query.isFetching

  return (
    <Page>
      {/* 모바일은 모듈 레이아웃의 뒤로가기 바(‹ 작업 ✦)가 헤더 — 헤더 바는 데스크톱에서만(내 작업과 동일). */}
      <Page.Header title="AI 위임 작업" mobile="hidden" />
      <Page.Body className="space-y-4">
        <h1 className={cn(pageTitleClass, 'lg:hidden')}>AI 위임 작업</h1>
        <AiTasksToolbar scope={scope} state={state} counts={countsQuery.data} />
        {query.isLoading ? (
          <p className="text-muted-foreground">로딩 중…</p>
        ) : query.isLoadingError ? (
          // 첫 페이지 실패만 오류 화면 — 다음 페이지 실패는 받은 행을 두고 LoadMoreFooter 가 다시 시도를 보인다.
          // (이 분기가 없으면 실패가 "맡긴 작업 없음" 빈 상태로 보인다.)
          <div className="flex items-center gap-2 py-3 text-sm" data-testid="ai-tasks-error">
            <span className="text-destructive">AI 위임 작업을 불러오지 못했습니다.</span>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              다시 시도
            </Button>
          </div>
        ) : empty ? (
          <AiTasksEmptyState filtered={filtered} />
        ) : isMobile ? (
          <AiTasksMobileList items={items} />
        ) : (
          <AiTasksTable items={items} done={state === 'DONE'} />
        )}
        {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter). */}
        <LoadMoreFooter query={query} data-testid="ai-row-more" />
      </Page.Body>
    </Page>
  )
}
