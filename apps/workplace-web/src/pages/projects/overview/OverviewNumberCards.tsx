// 프로젝트 개요(WP-1478) 숫자 카드 넷 — 완료·새로 생김(지난 7일, 그 전 7일과 나란히), 마감 임박(다음 7일), 기한 지남.
// 완료·새로 생김은 지표 모듈 값(모든 유형), 마감 임박·기한 지남은 이슈 탭 기본 범위(하위 작업·에픽 제외)의 열린 이슈다.
// 마감 임박·기한 지남은 같은 조건의 이슈 탭으로 가는 링크다(완료·새로 생김은 이슈 탭에 같은 조건이 없어 링크를 달지 않는다).
// 카드 모양은 내 작업 개요의 숫자 카드(StatCard)를 그대로 쓴다 — 링크만 개요 표시를 싣는 OverviewIssueLink.
import { cn } from '@/lib/utils'
import type { ProjectOverviewCards } from '@/types/projectOverview'

import { StatCard } from '../../me/overview/OverviewCard'
import { attentionHref, dueSoonHref } from './overviewModel'
import { OverviewIssueLink } from './OverviewParts'

/** 숫자 카드 줄 — 좁은 폭은 한 열로 쌓고, 중간 폭 2×2, 넓은 폭 한 줄 넷. */
export function OverviewNumberCards({ projectKey, today, cards }: { projectKey: string; today: string; cards: ProjectOverviewCards }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="project-overview-cards">
      <NumberCard testId="card-completed" title="완료 · 지난 7일" value={cards.completed.current} meta={`그 전 7일 ${cards.completed.previous}건`} />
      <NumberCard testId="card-created" title="새로 생김 · 지난 7일" value={cards.created.current} meta={`그 전 7일 ${cards.created.previous}건`} />
      <NumberCard
        testId="card-due-soon"
        title="마감 임박 · 다음 7일"
        value={cards.dueSoon.count}
        meta={`담당자 없음 ${cards.dueSoon.unassigned}`}
        href={dueSoonHref(projectKey, today)}
      />
      <NumberCard
        testId="card-overdue"
        title="기한 지남"
        value={cards.overdue.count}
        danger={cards.overdue.count > 0}
        meta={cards.overdue.oldestDays != null ? `가장 오래된 것 ${cards.overdue.oldestDays}일` : '기한 지난 이슈가 없어요'}
        href={attentionHref(projectKey, 'overdue', today)}
      />
    </div>
  )
}

/** 숫자 카드 하나 — StatCard 에 숫자·아랫줄 testid 를 달아 넘긴다. 기한 지남이 있으면 숫자를 destructive 로. */
function NumberCard({
  title,
  value,
  meta,
  href,
  danger,
  testId,
}: {
  title: string
  value: number
  meta: string
  href?: string
  danger?: boolean
  testId: string
}) {
  return (
    <StatCard
      testId={testId}
      title={title}
      href={href}
      LinkAs={OverviewIssueLink}
      value={
        <span className={cn(danger && 'text-destructive')} data-testid={`${testId}-value`}>
          {value}
        </span>
      }
      meta={<span data-testid={`${testId}-meta`}>{meta}</span>}
    />
  )
}
