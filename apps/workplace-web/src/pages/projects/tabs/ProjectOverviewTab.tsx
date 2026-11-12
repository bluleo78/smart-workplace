// 프로젝트 개요 탭(WP-1477 자리 → WP-1478 위젯) — 맨 위 「프로젝트 상태」 AI 요약 카드(WP-1479, 전체 폭·요약이 있을 때만), 숫자 카드 넷,
// 진행 중 + 열린 이슈, 살펴볼 이슈 + 작업량, 최근 활동. 값은 한 API(GET /projects/{key}/overview)가 한 번에 준다.
// 넓은 폭은 12칸 격자(8 + 4), 좁은 폭(모바일)은 한 열로 쌓는다.
import { Page } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectOverview } from '@/hooks/queries/useProjectOverview'
import { useProjectReports } from '@/hooks/queries/useProjectReports'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

import { OverviewActivity } from '../overview/OverviewActivity'
import { OverviewAttention } from '../overview/OverviewAttention'
import { OverviewNumberCards } from '../overview/OverviewNumberCards'
import { OverviewOpenIssues } from '../overview/OverviewOpenIssues'
import { OverviewProgress } from '../overview/OverviewProgress'
import { OverviewStatusCard } from '../overview/OverviewStatusCard'
import { OverviewWorkload } from '../overview/OverviewWorkload'
import { useProjectTabs } from './ProjectTabsContext'

/** 개요 탭 본문. 탭 제목은 다른 탭과 같은 「개요 · {프로젝트}」. */
export default function ProjectOverviewTab() {
  const { project } = useProjectTabs()
  useDocumentTitle(['개요', project.name])
  const query = useProjectOverview(project.key)
  // 리포트 줄(WP-1483)은 따로 부른다 — 실패하거나 늦어도 개요를 막지 않고 줄만 빠진다.
  const reports = useProjectReports(project.key)

  return (
    <Page.Body data-testid="project-overview">
      {query.isError && !query.data ? (
        <LoadErrorState
          variant="inline"
          title="개요를 불러오지 못했습니다"
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
          testId="project-overview-error"
        />
      ) : !query.data ? (
        <div aria-busy="true" aria-label="불러오는 중" className="space-y-4" data-testid="project-overview-loading">
          {/* 상태 카드 자리는 미리 잡지 않는다 — 대부분 프로젝트에는 요약 카드가 없어, 자리를 잡으면 불러온 뒤 위젯이 위로 튄다. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Skeleton className="h-72 lg:col-span-8" />
            <Skeleton className="h-72 lg:col-span-4" />
          </div>
        </div>
      ) : (
        <div className="min-w-0 space-y-4" data-testid="project-overview-widgets">
          <OverviewStatusCard status={query.data.statusSummary} report={reports.data} projectKey={project.key} />
          <OverviewNumberCards projectKey={project.key} today={query.data.today} cards={query.data.cards} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <OverviewProgress
              className="lg:col-span-8"
              projectKey={project.key}
              today={query.data.today}
              progress={query.data.progress}
              canManage={query.data.canManage}
            />
            <OverviewOpenIssues className="lg:col-span-4" projectKey={project.key} open={query.data.openIssues} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <OverviewAttention className="lg:col-span-8" projectKey={project.key} today={query.data.today} attention={query.data.attention} />
            <OverviewWorkload className="lg:col-span-4" projectKey={project.key} workload={query.data.workload} />
          </div>
          <OverviewActivity projectKey={project.key} activity={query.data.activity} />
        </div>
      )}
    </Page.Body>
  )
}
