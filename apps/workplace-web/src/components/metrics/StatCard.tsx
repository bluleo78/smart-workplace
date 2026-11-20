// 지표 숫자 카드(WP-1822) — 제목·큰 숫자·아랫줄(meta) 한 벌. 내 작업 개요·프로젝트 개요가 함께 쓴다.
// 카드 표면은 공용 MetricCard(DS 01 카드 토큰)를 쓴다.
import type { ComponentType } from 'react'
import { Link, type LinkProps } from 'react-router-dom'

import { MetricCard } from './MetricCard'

/**
 * 숫자 카드 하나. href 가 있으면 제목·숫자가 링크다 — 아랫줄(비교 툴팁)은 링크 밖에 둔다(터치에선 툴팁이 단추라 링크 안 단추가 되지 않게).
 * LinkAs 는 링크 컴포넌트 — 프로젝트 개요는 개요 표시를 싣는 링크(OverviewIssueLink)를 넘긴다. 기본은 그냥 Link.
 */
export function StatCard({
  title,
  value,
  meta,
  testId,
  href,
  LinkAs = Link,
}: {
  title: string
  value: React.ReactNode
  meta: React.ReactNode
  testId: string
  href?: string
  LinkAs?: ComponentType<Omit<LinkProps, 'state'>>
}) {
  const head = (
    <>
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
    </>
  )
  return (
    <MetricCard className="space-y-1" testId={testId}>
      {href ? (
        <LinkAs to={href} className="-m-1 block space-y-1 rounded p-1 hover:bg-muted/50" data-testid={`${testId}-link`}>
          {head}
        </LinkAs>
      ) : (
        head
      )}
      <div className="flex flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground">{meta}</div>
    </MetricCard>
  )
}
