// AI 위임 작업(WP-377) — AI 가 맡았거나 AI 도구로 진행 중인 이슈를 "내가 답하거나 검토할 것" 먼저 보여 주는 분류 화면.
// 조회는 서버 조건(/me/ai-tasks: 범위·AI 진행 상태·facet)이고 정렬도 서버 순서(급한 순) 그대로 쓴다.
// 칩 건수·AI 화면 컨텍스트 건수는 /me/ai-tasks/counts 에서 받는다(로드된 행 수가 아니라 전체 건수).
import { Bot } from 'lucide-react'
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

import { aiTaskParams } from './aiTasks/aiTaskParams'
import { AiTasksMobileList } from './aiTasks/AiTasksMobileList'
import { AiTasksTable } from './aiTasks/AiTasksTable'
import { AiTasksToolbar } from './aiTasks/AiTasksToolbar'
import { meFacetParams } from './meFacetParams'

export default function AiDelegatedTasksPage() {
  const [params] = useSearchParams()
  const { list, counts, scope, state } = useMemo(() => aiTaskParams(params), [params])
  const facets = useMemo(() => meFacetParams(params), [params])
  const query = useAiTasks(list)
  const countsQuery = useAiTaskCounts(counts)
  const isMobile = useIsMobile()

  // WP-54: AI 화면 컨텍스트 — facet + 전체 건수(counts.all). 건수를 받기 전엔 생략(로드 안 된 값은 보내지 않는다).
  const total = countsQuery.data?.all
  useRegisterAiScreenContext(useMemo(() => buildAiTasksContext({ facets, count: total }), [facets, total]))

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
          // 빈 상태 — 아이콘+제목(+설명) 3요소(DS §2.5). 빠른 필터 중이면 "조건" 문구로 구분한다.
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" data-testid="ai-row-empty">
            <Bot className="h-8 w-8 text-muted-foreground" />
            {state ? (
              <p className="text-sm font-semibold">조건에 맞는 AI 작업이 없어요</p>
            ) : (
              <>
                <p className="text-sm font-semibold">AI에게 맡긴 작업이 아직 없어요</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  이슈를 만들 때 담당자를 AI로 지정하면 여기에 표시됩니다.
                </p>
              </>
            )}
          </div>
        ) : isMobile ? (
          <AiTasksMobileList items={items} />
        ) : (
          <AiTasksTable items={items} />
        )}
        {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter). */}
        <LoadMoreFooter query={query} data-testid="ai-row-more" />
      </Page.Body>
    </Page>
  )
}
