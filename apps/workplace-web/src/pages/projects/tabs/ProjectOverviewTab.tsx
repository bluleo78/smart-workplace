// 프로젝트 개요 탭(WP-1477 자리 → WP-1478 위젯) — 숫자 카드 넷, 진행 중 + 열린 이슈, 살펴볼 이슈 + 작업량, 최근 활동.
// 값은 한 API(GET /projects/{key}/overview)가 한 번에 준다. 맨 위 상태·리포트 카드는 이 이슈 범위 밖이라 자리를 두지 않는다.
// 넓은 폭은 12칸 격자(8 + 4), 좁은 폭(모바일)은 한 열로 쌓는다.
import { Page } from '@/components/layout/Page'
import { LoadErrorState } from '@/components/LoadErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectOverview } from '@/hooks/queries/useProjectOverview'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

import { OverviewActivity } from '../overview/OverviewActivity'
import { OverviewAttention } from '../overview/OverviewAttention'
import { OverviewNumberCards } from '../overview/OverviewNumberCards'
import { OverviewOpenIssues } from '../overview/OverviewOpenIssues'
import { OverviewProgress } from '../overview/OverviewProgress'
import { OverviewWorkload } from '../overview/OverviewWorkload'
import { useProjectTabs } from './ProjectTabsContext'

/** 개요 탭 본문. 탭 제목은 다른 탭과 같은 「개요 · {프로젝트}」. */
export default function ProjectOverviewTab() {
  const { project } = useProjectTabs()
  useDocumentTitle(['개요', project.name])
  const query = useProjectOverview(project.key)

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
