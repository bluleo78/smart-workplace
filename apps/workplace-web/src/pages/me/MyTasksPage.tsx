// 내 작업 — 할당/내가 만든/구독 3탭. 경로 기반(/me/tasks/:tab)으로 공유 가능한 URL.
import { useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { Page } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { useWatchedIssues } from '@/hooks/queries/useWatchedIssues'
import { useIsMobile } from '@/hooks/useIsMobile'
import { buildMyTasksContext } from '@/lib/aiScreenContext/builders/issue'

import { meFacetParams } from './meFacetParams'
import { MeTaskFilterBar } from './MeTaskFilterBar'
import { MY_TASKS_TAB_LABEL } from './myTasksTabs'

// 할당/내가 만든 탭은 /me/issues 기반이라 status/priority facet 을 서버 쿼리로 합친다.
function AssignedTab() {
  const [params] = useSearchParams()
  const query = useMeIssues({ assignee: 'me', ...meFacetParams(params) })
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="assigned-row" emptyText="할당된 작업이 없습니다." />
  )
}

function ReportedTab() {
  const [params] = useSearchParams()
  const query = useMeIssues({ reporter: 'me', ...meFacetParams(params) })
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="reported-row" emptyText="내가 만든 작업이 없습니다." />
  )
}

// 구독 탭은 /me/watched-issues(다른 엔드포인트) — facet 미지원이라 필터 바를 노출하지 않는다.
function WatchedTab() {
  const query = useWatchedIssues()
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="watched-row" emptyText="구독 중인 작업이 없습니다." />
  )
}

const TABS = ['assigned', 'reported', 'watched'] as const
type Tab = (typeof TABS)[number]

export default function MyTasksPage() {
  const navigate = useNavigate()
  const { tab } = useParams<{ tab: string }>()
  // 잘못된 탭은 할당으로 폴백(에러 아님).
  const active: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'assigned'
  // WP-54: 탭 + facet 을 AI 화면 컨텍스트(목록 상태)로 등록 — 건수는 탭 하위 목록이 소유해 이번 범위에선 생략.
  // 구독 탭은 facet 을 적용하지 않으므로(필터 바 미노출) URL 에 남은 facet 을 싣지 않는다.
  const [params] = useSearchParams()
  const facets = useMemo(() => (active === 'watched' ? {} : meFacetParams(params)), [active, params])
  useRegisterAiScreenContext(useMemo(() => buildMyTasksContext({ tab: active, facets }), [active, facets]))
  // 모바일은 모듈 레이아웃의 뒤로가기 바(‹ 작업 ✦)가 헤더 — Page.Header 를 두면 그 바를 대체하므로 데스크톱에서만 헤더 바를 둔다.
  const isMobile = useIsMobile()

  return (
    <Page>
      {!isMobile && <Page.Header title="내 작업" />}
      <Page.Body className="space-y-4">
        {/* 모바일은 기존처럼 본문 첫 줄 큰 제목으로 화면 이름을 보인다. */}
        {isMobile && <h1 className={pageTitleClass}>내 작업</h1>}
        <Tabs value={active} onValueChange={(v) => navigate(`/me/tasks/${v}`)}>
          <TabsList>
            <TabsTrigger value="assigned" data-testid="tab-assigned">{MY_TASKS_TAB_LABEL.assigned}</TabsTrigger>
            <TabsTrigger value="reported" data-testid="tab-reported">{MY_TASKS_TAB_LABEL.reported}</TabsTrigger>
            <TabsTrigger value="watched" data-testid="tab-watched">{MY_TASKS_TAB_LABEL.watched}</TabsTrigger>
          </TabsList>
        </Tabs>
        {/* facet 바는 /me/issues 기반 탭(할당·내가 만든)에서만 노출 — 구독은 다른 엔드포인트라 제외. */}
        {active !== 'watched' && <MeTaskFilterBar />}
        {active === 'assigned' && <AssignedTab />}
        {active === 'reported' && <ReportedTab />}
        {active === 'watched' && <WatchedTab />}
      </Page.Body>
    </Page>
  )
}
