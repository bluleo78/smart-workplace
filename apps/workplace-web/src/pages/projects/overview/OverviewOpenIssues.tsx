// 프로젝트 개요(WP-1478) 「열린 이슈」 — 할 일·진행 중 두 범주(상태가 많아도 두 묶음으로) + 그중 담당자 없음.
// 줄을 누르면 같은 조건의 이슈 탭이 열린다. 막대 길이는 열린 이슈 전체에 대한 비율.
import { cn } from '@/lib/utils'
import type { ProjectOverviewOpenIssues } from '@/types/projectOverview'

import { OverviewCard } from '../../me/overview/OverviewCard'
import { statusHref, unassignedHref } from './overviewModel'
import { BarRow, WidgetEmpty, WidgetHeader } from './OverviewParts'

export function OverviewOpenIssues({ className, projectKey, open }: { className?: string; projectKey: string; open: ProjectOverviewOpenIssues }) {
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="project-overview-open">
      <WidgetHeader title="열린 이슈" aside={open.total} />
      {open.total === 0 ? (
        <WidgetEmpty testId="open-empty">열린 이슈가 없어요</WidgetEmpty>
      ) : (
        <div>
          <BarRow label="할 일" value={open.todo} max={open.total} barClass="bg-muted-foreground" href={statusHref(projectKey, 'TODO')} testId="open-todo" />
          <BarRow label="진행 중" value={open.inProgress} max={open.total} barClass="bg-primary" href={statusHref(projectKey, 'IN_PROGRESS')} testId="open-in-progress" />
          <div className="my-1 border-t border-border" />
          <BarRow label="담당자 없음" value={open.unassigned} max={open.total} barClass="bg-warning" href={unassignedHref(projectKey)} testId="open-unassigned" />
        </div>
      )}
    </OverviewCard>
  )
}
