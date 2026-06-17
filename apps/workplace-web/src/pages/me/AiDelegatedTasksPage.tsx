// AI 위임 작업 — 내가 만든 이슈(reporter=me) 중 담당이 AI(AGENT)인 것.
// 추가 백엔드 없이 reporter=me 결과를 클라이언트에서 kind 필터.
import { Bot } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { useMeIssues } from '@/hooks/queries/useMeIssues'

import { meFacetParams } from './meFacetParams'
import { MeTaskFilterBar } from './MeTaskFilterBar'

export default function AiDelegatedTasksPage() {
  const [params] = useSearchParams()
  // reporter=me + AGENT 제약은 유지하고, status/priority facet 만 서버 쿼리에 합친다.
  const query = useMeIssues({ reporter: 'me', ...meFacetParams(params) })
  return (
    <div className="container mx-auto p-6 space-y-4">
      <h1 className={pageTitleClass}>AI 위임 작업</h1>
      <MeTaskFilterBar />
      <InfiniteIssueList
        query={query}
        rowTestIdPrefix="ai-row"
        emptyText="AI에게 맡긴 작업이 아직 없어요"
        emptyIcon={Bot}
        emptyDescription="이슈를 만들 때 담당자를 AI로 지정하면 여기에 표시됩니다."
        filter={(it) => it.assignees.some((a) => a.kind === 'AGENT')}
        showAssignees
      />
    </div>
  )
}
