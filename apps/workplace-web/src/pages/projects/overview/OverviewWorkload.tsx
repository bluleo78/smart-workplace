// 프로젝트 개요(WP-1478) 「작업량」 — 열린 이슈를 많이 맡은 순 다섯 명(사람·AI) + 담당자 없음 + 「그 외 n명 · n건」.
// 담당자가 여럿인 이슈는 각자 센다(서버). AI 는 아바타 AI 표식과 AI 강조색 막대로 사람과 구분한다.
// 줄을 누르면 그 사람이 맡은(담당자 없음은 담당자 없는) 열린 이슈의 이슈 탭이 열린다.
import { cn } from '@/lib/utils'
import type { ProjectOverviewWorkload } from '@/types/projectOverview'

import { OverviewCard } from '../../me/overview/OverviewCard'
import { assigneeHref, unassignedHref } from './overviewModel'
import { BarRow, OverviewAvatar, WidgetEmpty, WidgetHeader } from './OverviewParts'

export function OverviewWorkload({ className, projectKey, workload }: { className?: string; projectKey: string; workload: ProjectOverviewWorkload }) {
  const { top, unassigned, others } = workload
  // 막대는 가장 많은 값(담당자 없음 포함)에 맞춘다.
  const max = Math.max(unassigned, ...top.map((u) => u.count))
  return (
    <OverviewCard className={cn('flex flex-col gap-3', className)} testId="project-overview-workload">
      <WidgetHeader title="작업량" aside="맡은 열린 이슈" />
      {top.length === 0 && unassigned === 0 ? (
        <WidgetEmpty testId="workload-empty">맡은 열린 이슈가 없어요</WidgetEmpty>
      ) : (
        <div>
          {top.map((u) => (
            <BarRow
              key={u.id}
              leading={<OverviewAvatar user={u} decorative />}
              label={u.name}
              value={u.count}
              max={max}
              barClass={u.kind === 'AGENT' ? 'bg-ai-accent' : 'bg-primary'}
              href={assigneeHref(projectKey, u.id)}
              testId={`workload-user-${u.id}`}
            />
          ))}
          {top.length > 0 && <div className="my-1 border-t border-border" />}
          <BarRow label="담당자 없음" value={unassigned} max={max} barClass="bg-warning" href={unassignedHref(projectKey)} testId="workload-unassigned" />
          {others.people > 0 && (
            <p className="px-1 pt-1 text-xs text-muted-foreground" data-testid="workload-others">
              그 외 {others.people}명 · {others.issues}건
            </p>
          )}
        </div>
      )}
    </OverviewCard>
  )
}
