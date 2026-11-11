// 프로젝트 개요(WP-1478) 「최근 활동」 — 이슈 이력을 같은 사람·같은 종류끼리 묶은 앞의 여섯 묶음(서버가 6개까지 준다)을 두 열 세 줄로.
// 묶음이 한 건이면(서버가 issue 를 싣는다) 그 이슈로 가는 링크, 여러 건이면 「이슈 n건 …」 글만. 「모두 보기」는 최근 수정 순 이슈 탭.
import { Link } from 'react-router-dom'

import { issuePath } from '@/lib/appUrl'
import { formatRelativeTime } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { ProjectActivityGroup } from '@/types/projectOverview'

import { OverviewCard } from '../../me/overview/OverviewCard'
import { activityAllHref, activityText } from './overviewModel'
import { WidgetEmpty, WidgetHeader } from './OverviewParts'

export function OverviewActivity({ className, projectKey, activity }: { className?: string; projectKey: string; activity: ProjectActivityGroup[] }) {
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="project-overview-activity">
      <WidgetHeader title="최근 활동" link={{ label: '모두 보기', href: activityAllHref(projectKey), testId: 'activity-all' }} />
      {activity.length === 0 ? (
        <WidgetEmpty testId="activity-empty">아직 활동이 없어요</WidgetEmpty>
      ) : (
        <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2" data-testid="activity-list">
          {activity.map((g, i) => (
            <li key={`${g.actor.id}-${g.eventType}-${g.latestAt}-${i}`} className="border-b border-border">
              <ActivityRow projectKey={projectKey} group={g} />
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  )
}

/** 활동 한 줄 — 「양동희 · WP-12 상태 변경 제목…」 + 오른쪽 상대 시각. 한 건이면 줄 전체가 이슈 링크. */
function ActivityRow({ projectKey, group }: { projectKey: string; group: ProjectActivityGroup }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">
        <span className={cn(group.actor.kind === 'AGENT' && 'text-ai-accent')}>{group.actor.name}</span>
        <span className="text-muted-foreground"> · </span>
        {activityText(group)}
        {group.issue && <span className="text-muted-foreground"> {group.issue.title}</span>}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(group.latestAt)}</span>
    </>
  )
  const cls = 'flex items-center gap-3 px-1 py-2 text-sm'
  return group.issue ? (
    <Link to={issuePath(projectKey, group.issue.number)} className={cn(cls, 'rounded hover:bg-muted/50')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
