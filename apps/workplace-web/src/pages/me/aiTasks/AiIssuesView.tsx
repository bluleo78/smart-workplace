// AI 위임 작업 「이슈별」 보기 본문(WP-377) — 툴바(범위·facet·보기) + AI 진행 빠른 필터 칩 + 이슈 목록(무한 스크롤).
// 조회는 서버 조건(/me/ai-tasks: 범위·AI 진행 상태·facet)이고 정렬도 서버 순서(급한 순) 그대로 쓴다.
// 칩 건수·AI 화면 컨텍스트 건수는 /me/ai-tasks/counts 에서 받는다(로드된 행 수가 아니라 서버 건수).
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { ListLoadingSkeleton } from '@/components/issue/ListLoadingSkeleton'
import { LoadErrorState } from '@/components/LoadErrorState'
import { LoadMoreFooter } from '@/components/ui/load-more-footer'
import { useAiTaskCounts, useAiTasks } from '@/hooks/queries/useAiTasks'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildAiTasksContext } from '@/lib/aiScreenContext/builders/issue'
import { failedWithoutData } from '@/lib/queryFailure'

import { MeTaskFilterBar } from '../MeTaskFilterBar'
import { aiTaskParams, QUICK_STATE_META, QUICK_STATES } from './aiTaskParams'
import { AiTasksEmptyState } from './AiTasksEmptyState'
import { AiTasksMobileList } from './AiTasksMobileList'
import { AiTasksTable } from './AiTasksTable'
import { AiTasksToolbar } from './AiTasksToolbar'
import { ToggleChips } from './ToggleChips'

export function AiIssuesView({ scrollEl }: { scrollEl: HTMLDivElement | null }) {
  const [params, setParams] = useSearchParams()
  // facet 은 이 화면이 서버에 실제로 보내는 것(status/priority)만 — 빈 상태 판정·AI 화면 컨텍스트도 같은 값을 쓴다.
  const { list, counts, facets, filtered, doneView, scope, state } = useMemo(() => aiTaskParams(params), [params])
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

  // 빠른 필터 칩 — 미완료(기본, 키를 지운다) + 상태 다섯 + 완료(WP-396). 모두 배타적 단일 선택이고 다른 쿼리(facet 등)는 보존.
  // 기본 칩 라벨은 「미완료」(진행 중 작업이 있는 이슈 전부). 「진행 중」이 아닌 이유: 하위 칩 「작업 중」(WORKING)과 헷갈리고,
  // 이슈 상태 facet(할 일/진행 중/완료/취소)의 「진행 중」과도 단어가 겹친다. 칩 키는 counts 응답 필드명과 같다(미완료는 옛 「전체」 자리라 all).
  const setState = (value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set('state', value)
    else next.delete('state')
    setParams(next, { replace: true })
  }
  const chips = [
    { key: 'all', label: '미완료', on: state === null, count: countsQuery.data?.all, onClick: () => setState(null) },
    ...QUICK_STATES.map((s) => {
      const { countKey, label } = QUICK_STATE_META[s]
      return { key: countKey, label, on: state === s, count: countsQuery.data?.[countKey], onClick: () => setState(s) }
    }),
  ]

  const items = query.data?.pages.flatMap((p) => p.items ?? []).filter((x) => x != null) ?? []
  // 마지막 페이지까지 받은 뒤에만 빈 상태 — 스트리밍 중 깜빡임 방지(InfiniteIssueList 와 같은 기준).
  const empty = items.length === 0 && !query.hasNextPage && !query.isFetching

  return (
    <>
      <AiTasksToolbar view="issues" scope={scope} filters={<MeTaskFilterBar />} />
      <ToggleChips chips={chips} label="AI 진행 빠른 필터" testIds={{ row: 'ai-quick-chips', chip: 'ai-quick', count: 'ai-quick-count' }} />
      {failedWithoutData(query) ? (
        // 첫 페이지 실패만 오류 화면 — 다음 페이지 실패는 받은 행을 두고 LoadMoreFooter 가 다시 시도를 보인다.
        // (이 분기가 없으면 실패가 "맡긴 작업 없음" 빈 상태로 보인다.) 로딩보다 먼저 본다 — 다시 시도로 부르는 동안(pending)에도
        // 안내를 두어 키보드 초점이 다시 시도에 남게 한다(WP-893, 내 작업·프로젝트 목록과 같은 기준).
        <LoadErrorState
          title="AI 위임 작업을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          queries={[query]}
          testId="ai-tasks-error"
        />
      ) : query.isLoading ? (
        // 첫 로딩 — 표 자리 스켈레톤(DS 06 §A-2). 내 작업 목록과 같은 모양(모바일은 행이 높아 3행).
        <ListLoadingSkeleton label="AI 위임 작업 불러오는 중" />
      ) : empty ? (
        <AiTasksEmptyState filtered={filtered} doneView={doneView} />
      ) : isMobile ? (
        <AiTasksMobileList items={items} />
      ) : (
        <AiTasksTable items={items} done={state === 'DONE'} />
      )}
      {/* 목록 끝 — 자동 로드, 다음 페이지 실패 시에만 다시 시도(공용 LoadMoreFooter). */}
      <LoadMoreFooter query={query} root={scrollEl} data-testid="ai-row-more" />
    </>
  )
}
