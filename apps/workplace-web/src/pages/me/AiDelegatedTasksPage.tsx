// AI 위임 작업 — 내가 만든 이슈(reporter=me) 중 담당이 AI(AGENT)인 것.
// 추가 백엔드 없이 reporter=me 결과를 클라이언트에서 kind 필터.
import { Bot } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext'
import { InfiniteIssueList } from '@/components/issue/InfiniteIssueList'
import { Page } from '@/components/layout/Page'
import { pageTitleClass } from '@/components/layout/sidebar-link'
import { useMeIssues } from '@/hooks/queries/useMeIssues'
import { buildAiTasksContext } from '@/lib/aiScreenContext/builders/issue'
import { cn } from '@/lib/utils'
import type { IssueResponse } from '@/types/issue'

import { meFacetParams } from './meFacetParams'
import { MeTaskFilterBar } from './MeTaskFilterBar'

// AI(AGENT) 담당 여부 — 목록 필터와 화면 컨텍스트 건수가 같은 기준을 쓰도록 공유.
const isAiDelegated = (it: IssueResponse) => it.assignees.some((a) => a.kind === 'AGENT')

export default function AiDelegatedTasksPage() {
  const [params] = useSearchParams()
  const facets = useMemo(() => meFacetParams(params), [params])
  // reporter=me + AGENT 제약은 유지하고, status/priority facet 만 서버 쿼리에 합친다.
  const query = useMeIssues({ reporter: 'me', ...facets })
  // WP-54: AI 화면 컨텍스트 — facet + 로드된(클라이언트 AGENT 필터 후) 건수. 첫 로드 전엔 건수 생략.
  const count = query.data
    ? query.data.pages.flatMap((p) => p.items ?? []).filter((x) => x != null && isAiDelegated(x)).length
    : undefined
  useRegisterAiScreenContext(useMemo(() => buildAiTasksContext({ facets, count }), [facets, count]))
  return (
    <Page>
      {/* 모바일은 모듈 레이아웃의 뒤로가기 바(‹ 작업 ✦)가 헤더 — 헤더 바는 데스크톱에서만(내 작업과 동일). */}
      <Page.Header title="AI 위임 작업" mobile="hidden" />
      <Page.Body className="space-y-4">
        <h1 className={cn(pageTitleClass, 'lg:hidden')}>AI 위임 작업</h1>
        <MeTaskFilterBar />
        <InfiniteIssueList
          query={query}
          rowTestIdPrefix="ai-row"
          emptyText="AI에게 맡긴 작업이 아직 없어요"
          emptyIcon={Bot}
          emptyDescription="이슈를 만들 때 담당자를 AI로 지정하면 여기에 표시됩니다."
          filter={isAiDelegated}
          showAssignees
        />
      </Page.Body>
    </Page>
  )
}
