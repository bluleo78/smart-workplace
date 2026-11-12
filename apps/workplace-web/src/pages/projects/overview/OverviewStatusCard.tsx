// 프로젝트 개요 맨 위 「프로젝트 상태」 카드(WP-1479) — 배지 칩(시스템이 정한 순조로움·주의·위험) · 제목 · 「AI 요약 · 오늘 14:00 갱신 · 다음 16:00」 · AI 요약 글.
// 배지는 숫자 규칙(예상 완료가 종료일보다 늦은 일수)으로 서버가 조회 때마다 정하고, AI 는 글만 쓴다.
// 요약 아래에는 구분선과 최신 리포트 줄(WP-1483)을 둔다. 요약이 없어도 리포트가 있으면 리포트 줄만 그리고, 둘 다 없으면 카드를 그리지 않는다.
// 좁은 폭에서는 머리줄(배지·제목)과 시각 줄이 줄바꿈되어 쌓인다.
import type { ReactNode } from 'react'

import { StatusBadge } from '@/components/ui/status-badge'
import { formatKstDayClock } from '@/lib/formatters'
import type { ProjectStatusSummary } from '@/types/projectOverview'
import type { ProjectReportCardResponse } from '@/types/projectReport'

import { OverviewCard } from '../../me/overview/OverviewCard'
import { OverviewReportLine } from './OverviewReportLine'
import { PROJECT_STATUS_BADGE } from './projectStatusBadge'

/**
 * 상태 요약 카드. status 도 최신 리포트도 없으면 아무것도 그리지 않는다.
 * now 는 「오늘」 판정 기준(테스트가 고정한다) — 기본은 지금.
 */
export function OverviewStatusCard({
  status,
  report,
  projectKey,
  now = new Date(),
}: {
  status: ProjectStatusSummary | null
  /** 개요 리포트 줄(WP-1483) — 아직 안 왔거나 최신이 없으면 줄을 그리지 않는다. */
  report?: ProjectReportCardResponse | null
  /** 리포트 줄 링크(노트 탭 주소)에 쓰는 프로젝트 키. */
  projectKey: string
  now?: Date
}) {
  const hasReport = !!report?.latest
  if (!status && !hasReport) return null
  const reportLine = hasReport && <OverviewReportLine report={report} projectKey={projectKey} now={now} />

  return (
    <OverviewCard className="flex flex-col gap-2" testId="overview-status-card">
      {/* 요약이 없으면 리포트 줄만 담은 카드. */}
      {status ? <StatusSummaryBody status={status} hasReport={hasReport} reportLine={reportLine} now={now} /> : reportLine}
    </OverviewCard>
  )
}

/** 요약이 있을 때의 카드 안 — 배지·제목·시각 줄·요약 글, 리포트가 있으면 구분선 아래 리포트 줄. */
function StatusSummaryBody({
  status,
  hasReport,
  reportLine,
  now,
}: {
  status: ProjectStatusSummary
  hasReport: boolean
  reportLine: ReactNode
  now: Date
}) {
  const badge = PROJECT_STATUS_BADGE[status.badge]
  const checked = formatKstDayClock(status.checkedAt, now, '오늘')
  // 다음 점검 시각이 이미 지났으면(실행기가 곧 다시 살핀다 — 5분 주기·처리 상한으로 늦어질 수 있다) 지난 시각을 「다음」으로 보이지 않게 뺀다.
  const nextAt = new Date(status.nextRunAt).getTime()
  const next = nextAt > now.getTime() ? formatKstDayClock(status.nextRunAt, now) : null
  // 시각 줄 — 무효 시각·지난 다음 시각은 그 세그먼트를 뺀다.
  const meta = ['AI 요약', checked && `${checked} 갱신`, next && `다음 ${next}`].filter(Boolean).join(' · ')

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge type={badge.type} data-testid="overview-status-badge">
            {badge.label}
          </StatusBadge>
          <h2 className="text-sm font-semibold">프로젝트 상태</h2>
        </div>
        <span className="text-xs text-muted-foreground" data-testid="overview-status-meta">
          {meta}
        </span>
      </div>
      <p className="whitespace-pre-line break-words text-sm leading-relaxed">{status.summary}</p>
      {/* 리포트 줄(WP-1483) — 요약과 구분선으로 나눈다. */}
      {hasReport && <div className="border-t border-border pt-2">{reportLine}</div>}
    </>
  )
}
