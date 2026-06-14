// 내 작업 — 할당/내가 만든/구독 3탭. 경로 기반(/me/tasks/:tab)으로 공유 가능한 URL.
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { useWatchedIssues } from '@/hooks/queries/useWatchedIssues'

import { meFacetParams } from './meFacetParams'
import { MeTaskFilterBar } from './MeTaskFilterBar'

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

  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">내 작업</h1>
      <Tabs value={active} onValueChange={(v) => navigate(`/me/tasks/${v}`)}>
        <TabsList>
          <TabsTrigger value="assigned" data-testid="tab-assigned">할당</TabsTrigger>
          <TabsTrigger value="reported" data-testid="tab-reported">내가 만든</TabsTrigger>
          <TabsTrigger value="watched" data-testid="tab-watched">구독</TabsTrigger>
        </TabsList>
      </Tabs>
      {/* facet 바는 /me/issues 기반 탭(할당·내가 만든)에서만 노출 — 구독은 다른 엔드포인트라 제외. */}
      {active !== 'watched' && <MeTaskFilterBar />}
      {active === 'assigned' && <AssignedTab />}
      {active === 'reported' && <ReportedTab />}
      {active === 'watched' && <WatchedTab />}
    </div>
  )
}
