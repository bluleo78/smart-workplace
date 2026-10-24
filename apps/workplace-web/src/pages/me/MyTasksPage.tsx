// 내 작업 — 할당/내가 만든/구독 3탭. 경로 기반(/me/tasks/:tab)으로 공유 가능한 URL.
import { useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { Page } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { useWatchedIssues } from '@/hooks/queries/useWatchedIssues'
import { buildMyTasksContext } from '@/lib/aiScreenContext/builders/issue'
import { cn } from '@/lib/utils'

import { meFacetParams } from './meFacetParams'
import { MeTaskFilterBar } from './MeTaskFilterBar'
import { clearMyTasksFilters, hasMyTasksFilters, isHidingClosed, myTasksQueryParams, type MyTasksTab } from './myTasksQuery'
import { MY_TASKS_TAB_LABEL } from './myTasksTabs'

// 할당/내가 만든 탭은 /me/issues 기반 — 프로젝트 묶음 정렬(group)과 facet 을 서버 쿼리로 합친다(myTasksQuery, WP-916).
// 할당 탭은 내가 맡은 일이라 담당자 열을 두지 않고, 내가 만든·구독 탭은 남이 맡은 일이 섞여 담당자 열을 둔다.

/** URL 필터 상태 — 필터 0건 판정과 필터 초기화(탭 경로는 두고 필터 키만 지움)를 두 탭이 함께 쓴다. */
function useMyTasksFilters() {
  const [params, setParams] = useSearchParams()
  return {
    params,
    filtered: hasMyTasksFilters(params),
    resetFilters: () => setParams((prev) => clearMyTasksFilters(prev), { replace: true }),
    /** 「완료 모두 보기」 켜기 — 필터 바 토글과 같은 URL 키(closed=all). */
    showAllClosed: () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('closed', 'all')
          return next
        },
        { replace: true },
      ),
  }
}

function AssignedTab({ scrollRoot }: { scrollRoot: Element | null }) {
  const { params, filtered, resetFilters, showAllClosed } = useMyTasksFilters()
  const query = useMeIssues(myTasksQueryParams('assigned', params))
  // 완료를 숨겨 비었을 수 있다 — 숨겼다고 알리고 「완료 모두 보기」를 다음 행동으로 준다(프로젝트 목록 WP-606 과 같은 안내).
  // 필터 0건에서도 같다 — 걸린 이슈가 완료라 숨겨진 것인지 구분하게, 초기화 옆에 바로가기를 둔다(WP-941).
  const hiding = isHidingClosed(params)
  const showClosedAction = hiding ? { label: '완료 모두 보기', onClick: showAllClosed, testIdSuffix: 'show-closed' } : undefined
  return (
    <InfiniteIssueList
      query={query}
      rowTestIdPrefix="assigned-row"
      showAssignee={false}
      empty={{
        title: '할당된 작업이 없습니다',
        description: hiding ? '완료한 작업은 「완료 모두 보기」로 볼 수 있습니다' : undefined,
        action: showClosedAction,
      }}
      filtered={filtered}
      filteredDescription={
        hiding
          ? '할당된 작업은 있지만 필터에 걸러졌습니다. 완료·취소한 작업은 숨겨져 있습니다'
          : '할당된 작업은 있지만 필터에 걸러졌습니다'
      }
      filteredAction={showClosedAction}
      onResetFilters={resetFilters}
      scrollRoot={scrollRoot}
    />
  )
}

function ReportedTab({ scrollRoot }: { scrollRoot: Element | null }) {
  const { params, filtered, resetFilters } = useMyTasksFilters()
  const query = useMeIssues(myTasksQueryParams('reported', params))
  return (
    <InfiniteIssueList
      query={query}
      rowTestIdPrefix="reported-row"
      showAssignee
      empty={{ title: '내가 만든 작업이 없습니다' }}
      filtered={filtered}
      filteredDescription="내가 만든 작업은 있지만 필터에 걸러졌습니다"
      onResetFilters={resetFilters}
      scrollRoot={scrollRoot}
    />
  )
}

// 구독 탭은 /me/watched-issues(다른 엔드포인트) — facet 미지원이라 필터 바를 노출하지 않고 필터 0건도 없다. 최근 순 프로젝트 묶음(WP-915).
function WatchedTab({ scrollRoot }: { scrollRoot: Element | null }) {
  const query = useWatchedIssues(30, 'recent')
  return (
    <InfiniteIssueList
      query={query}
      rowTestIdPrefix="watched-row"
      showAssignee
      empty={{ title: '구독 중인 작업이 없습니다', description: '이슈 상세에서 구독하면 여기에 모입니다' }}
      filtered={false}
      scrollRoot={scrollRoot}
    />
  )
}

const TABS: readonly MyTasksTab[] = ['assigned', 'reported', 'watched']

export default function MyTasksPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab: string }>()
  const isKnownTab = (TABS as readonly string[]).includes(tab ?? '')
  // 잘못된 탭은 할당으로 그린 뒤 아래에서 주소도 할당 탭으로 바로잡는다(에러 아님).
  const active: MyTasksTab = isKnownTab ? (tab as MyTasksTab) : 'assigned'
  // WP-54: 탭 + facet 을 AI 화면 컨텍스트(목록 상태)로 등록 — 건수는 탭 하위 목록이 소유해 이번 범위에선 생략.
  // 구독 탭은 facet 을 적용하지 않으므로(필터 바 미노출) URL 에 남은 facet 을 싣지 않는다.
  const [params] = useSearchParams()
  const facets = useMemo(() => (active === 'watched' ? {} : meFacetParams(params)), [active, params])
  useRegisterAiScreenContext(useMemo(() => buildMyTasksContext({ tab: active, facets }), [active, facets]))
  // 본문 스크롤 요소 — 탭 목록 무한 로드 sentinel 의 root(DS 05 §A-3). state ref 라 마운트 뒤 observer 가 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  // 알 수 없는 탭 주소(/me/tasks/abc)는 할당 탭 주소로 바꾼다 — 주소가 그대로 남으면 공유·새로고침해도
  // 없는 탭 주소가 퍼지고, 보이는 탭과 주소가 어긋난다(WP-926). 필터 쿼리는 그대로 넘긴다.
  if (!isKnownTab) return <Navigate to={{ pathname: '/me/tasks/assigned', search: params.toString() }} replace />

  return (
    <Page>
      {/* 모바일은 모듈 레이아웃의 뒤로가기 바(‹ 작업 ✦)가 헤더 — Page.Header 를 두면 그 바를 대체하므로 모바일에선 숨긴다. */}
      <Page.Header title="내 작업" mobile="hidden" />
      <Page.Body className="space-y-4" scrollRef={setScrollEl}>
        {/* 모바일은 기존처럼 본문 첫 줄 큰 제목으로 화면 이름을 보인다(데스크톱은 헤더 제목이 대신). */}
        <h1 className={cn(pageTitleClass, 'lg:hidden')}>내 작업</h1>
        {/* 탭 내용은 TabsContent(role=tabpanel) 안에 둔다 — 없으면 탭의 aria-controls 가 없는 id 를 가리켜 스크린리더가 탭과
            내용을 잇지 못한다(WP-841). 선택 탭의 패널만 그려진다(Radix 기본). */}
        <Tabs value={active} onValueChange={(v) => navigate(`/me/tasks/${v}`)} className="gap-4">
          <TabsList>
            <TabsTrigger value="assigned" data-testid="tab-assigned">{MY_TASKS_TAB_LABEL.assigned}</TabsTrigger>
            <TabsTrigger value="reported" data-testid="tab-reported">{MY_TASKS_TAB_LABEL.reported}</TabsTrigger>
            <TabsTrigger value="watched" data-testid="tab-watched">{MY_TASKS_TAB_LABEL.watched}</TabsTrigger>
          </TabsList>
          {/* facet 바는 /me/issues 기반 탭(할당·내가 만든)에서만 노출 — 구독은 다른 엔드포인트라 제외. */}
          <TabsContent value="assigned" className="space-y-4">
            {/* 할당 탭만 완료를 기본으로 숨기므로 「완료 모두 보기」 토글을 둔다(WP-916). */}
            <MeTaskFilterBar showClosedToggle />
            <AssignedTab scrollRoot={scrollEl} />
          </TabsContent>
          <TabsContent value="reported" className="space-y-4">
            <MeTaskFilterBar />
            <ReportedTab scrollRoot={scrollEl} />
          </TabsContent>
          <TabsContent value="watched">
            <WatchedTab scrollRoot={scrollEl} />
          </TabsContent>
        </Tabs>
      </Page.Body>
    </Page>
  )
}
