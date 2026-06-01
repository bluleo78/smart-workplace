// 내 작업 — 할당/내가 만든/구독 3탭. 경로 기반(/me/tasks/:tab)으로 공유 가능한 URL.
import { useNavigate, useParams } from 'react-router-dom'

import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { useWatchedIssues } from '@/hooks/queries/useWatchedIssues'

const TABS = ['assigned', 'reported', 'watched'] as const
type Tab = (typeof TABS)[number]

function AssignedTab() {
  const query = useMeIssues({ assignee: 'me' })
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="assigned-row" emptyText="할당된 작업이 없습니다." />
  )
}

function ReportedTab() {
  const query = useMeIssues({ reporter: 'me' })
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="reported-row" emptyText="내가 만든 작업이 없습니다." />
  )
}

function WatchedTab() {
  const query = useWatchedIssues()
  return (
    <InfiniteIssueList query={query} rowTestIdPrefix="watched-row" emptyText="구독 중인 작업이 없습니다." />
  )
}

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
      {active === 'assigned' && <AssignedTab />}
      {active === 'reported' && <ReportedTab />}
      {active === 'watched' && <WatchedTab />}
    </div>
  )
}
