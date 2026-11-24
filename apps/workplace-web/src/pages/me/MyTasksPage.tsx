// 내 작업 — 개요/할당/내가 만든/구독 4탭(개요 WP-1484). 경로 기반(/me/tasks/:tab)으로 공유 가능한 URL.
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { Page } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { useWatchedIssues } from '@/hooks/queries/useWatchedIssues'
import { useMyWorkflowTurns } from '@/hooks/queries/useWorkflowRuns'
import { buildMyTasksContext } from '@/lib/aiScreenContext/builders/issue'
import { revealInScrollX } from '@/lib/revealInScrollX'
import { HIDE_SCROLLBAR } from '@/lib/scrollStyles'
import { cn } from '@/lib/utils'

import { meFacetParams } from './meFacetParams'
import { MeTaskFilterBar } from './MeTaskFilterBar'
import { isMyTasksTab, readLastMyTasksTab, useMyTasksTabKey, writeLastMyTasksTab } from './myTasksLastTab'
import { clearMyTasksFilters, hasMyTasksFilters, isHidingClosed, myTasksQueryParams, type MyTasksTab } from './myTasksQuery'
import { MY_TASKS_TAB_LABEL } from './myTasksTabs'
import { MyTurnsTab } from './MyTurnsTab'
import { MyOverviewTab, OverviewPeriodPicker } from './overview/MyOverviewTab'

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

export default function MyTasksPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab: string }>()
  const isKnownTab = isMyTasksTab(tab)
  const tabKey = useMyTasksTabKey()
  // 「내 차례」 수 배지 — 탭이 열릴 때만 읽지 않도록 탭 줄에서도 같은 조회를 쓴다(캐시 공유).
  const turnCount = useMyWorkflowTurns().data?.length ?? 0
  // 잘못된 탭은 마지막에 본 탭(없으면 개요)으로 그린 뒤 아래에서 주소도 그 탭으로 바로잡는다(에러 아님).
  const active: MyTasksTab = isKnownTab ? (tab as MyTasksTab) : readLastMyTasksTab(tabKey)
  // 지금 보는 탭을 기억한다 — 다음에 /me/tasks(사이드바 「내 작업」)로 들어오면 이 탭으로 연다(WP-1484, 프로젝트 화면 기억과 같은 규칙).
  useEffect(() => {
    if (isKnownTab) writeLastMyTasksTab(tabKey, active)
  }, [isKnownTab, tabKey, active])
  // WP-54: 탭 + facet 을 AI 화면 컨텍스트(목록 상태)로 등록 — 건수는 탭 하위 목록이 소유해 이번 범위에선 생략.
  // 구독 탭은 facet 을 적용하지 않으므로(필터 바 미노출) URL 에 남은 facet 을 싣지 않는다.
  const [params] = useSearchParams()
  const facets = useMemo(() => (active === 'watched' || active === 'overview' || active === 'turns' ? {} : meFacetParams(params)), [active, params])
  useRegisterAiScreenContext(useMemo(() => buildMyTasksContext({ tab: active, facets }), [active, facets]))
  // 본문 스크롤 요소 — 탭 목록 무한 로드 sentinel 의 root(DS 05 §A-3). state ref 라 마운트 뒤 observer 가 다시 붙는다.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // 탭 줄 래퍼 — 활성 탭이 래퍼 안에 다 보이도록 스크롤 위치를 맞춘다(WP-2045 리뷰 후속 1).
  // ref 가 아니라 state 로 받는다 — 알 수 없는 탭 주소는 아래 <Navigate> 를 거쳐 다시 그리는데, 그때 ref 는 이미 달려 있어
  // deps 가 그대로라 effect 가 다시 돌지 않기 때문이다(본문 스크롤러 scrollEl 과 같은 방식).
  const [tabStrip, setTabStrip] = useState<HTMLDivElement | null>(null)
  // 주소로 /me/tasks/turns 에 바로 들어오면(링크·새로고침) 래퍼는 scrollLeft 0 에서 시작하는데 오른쪽 끝의 「내 차례」 탭은
  // 넘침 구간에 있어 잘린 채로 보인다. 활성 트리거가 래퍼 안에 들어올 때까지 래퍼의 scrollLeft 만 움직인다.
  // 칩 줄(SearchPalette)과 같은 도우미를 쓰는 건 — scrollIntoView 는 넘침이 숨겨진 조상·문서까지 굴려 세로로 페이지를
  // 튈 수 있다. turnCount 를 함께 보는 건 건수 배지가 뒤에 붙어 탭이 더 넓어지기 때문이고, 그려진 직내에 맞추려
  // layout effect 다(첫 paint 에 잘린 탭이 한 프레임 보이지 않게).
  useLayoutEffect(() => {
    if (!tabStrip) return
    const trigger = tabStrip.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
    if (!trigger) return
    revealInScrollX(tabStrip, trigger)
  }, [tabStrip, active, turnCount])

  // 알 수 없는 탭 주소(/me/tasks/abc)는 마지막에 본 탭(없으면 개요) 주소로 바꾼다 — 주소가 그대로 남으면 공유·새로고침해도
  // 없는 탭 주소가 퍼지고, 보이는 탭과 주소가 어긋난다(WP-926). 필터 쿼리는 그대로 넘긴다.
  if (!isKnownTab) return <Navigate to={{ pathname: `/me/tasks/${active}`, search: params.toString() }} replace />

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
          {/* 탭 줄 오른쪽 — 개요 탭에서만 「나만 볼 수 있어요」 + 기간 고르기. 좁은 폭은 탭 아래로 내려간다. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* 탭 줄 넘침(390px 에서 5개 탭 392px > 본문 폭)을 탭 줄 상자 안에 가둔다 — 그대로 두면 넘침이 Page.Body 스크롤러로
                전파돼 탭 선택 때 포커스·scrollIntoView 가 페이지를 가로로 밀었다(WP-2045).
                overflow-x-auto 는 CSS 상 overflow-y 를 auto 로 계산해 자기 상자 높이(36px)만 세로로 그리는데, 활성 밑줄
                (TabsTrigger 의 after, bottom -5px)은 TabsList 상자 아래로 1.5px 나가 래퍼가 그대로 잘랐다 — 390px 실측
                밑줄 하단 160.5px > 래퍼 클립 경계 160px (0.5px 잘림). 그래서 세로 여유 pb-1(+4px)을 주어 밑줄이 상자 안에
                들어오게 하고, -mb-1 로 높이·배치는 그대로 둔다(MobileBoard 선례는 TabsList 자체에 스크롤을 걸어
                after:bottom-0 으로 밑줄을 5px 올렸지만, 여기는 데스크톱·모바일이 같은 마크업이라 모양을 바꾸지 않고
                여유만 더한다). 활성 탭이 래퍼 밖(오른쪽 넘침 구간)에 걸리면 위 layout effect 가 래퍼 scrollLeft 를 맞춰
                바로 잡는다(주소로 직접 들어온 경우 — WP-2045 리뷰 후속). */}
            <div ref={setTabStrip} className={cn('min-w-0 max-w-full overflow-x-auto pb-1 -mb-1', HIDE_SCROLLBAR)}>
              <TabsList>
                <TabsTrigger value="overview" data-testid="tab-overview">{MY_TASKS_TAB_LABEL.overview}</TabsTrigger>
                <TabsTrigger value="assigned" data-testid="tab-assigned">{MY_TASKS_TAB_LABEL.assigned}</TabsTrigger>
                <TabsTrigger value="reported" data-testid="tab-reported">{MY_TASKS_TAB_LABEL.reported}</TabsTrigger>
                <TabsTrigger value="watched" data-testid="tab-watched">{MY_TASKS_TAB_LABEL.watched}</TabsTrigger>
                <TabsTrigger value="turns" data-testid="tab-turns">
                  {MY_TASKS_TAB_LABEL.turns}
                  {turnCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 text-xs tabular-nums" data-testid="tab-turns-count">
                      {/* 숫자는 눈으로만 읽게 하고, 스크린리더에는 앞에 공백을 둔 「 n건」을 읽어 「내 차례2」로 붙지 않게 한다. */}
                      <span aria-hidden="true">{turnCount}</span>
                      <span className="sr-only">{` ${turnCount}건`}</span>
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>
            {active === 'overview' && <OverviewPeriodPicker />}
          </div>
          <TabsContent value="overview">
            <MyOverviewTab />
          </TabsContent>
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
          <TabsContent value="turns">
            <MyTurnsTab />
          </TabsContent>
        </Tabs>
      </Page.Body>
    </Page>
  )
}
