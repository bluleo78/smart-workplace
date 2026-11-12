// 프로젝트 개요 맨 위 「프로젝트 상태」 카드(WP-1479) — 배지 칩(시스템이 정한 순조로움·주의·위험) · 제목 · 「AI 요약 · 오늘 14:00 갱신 · 다음 16:00」 · AI 요약 글.
// 배지는 숫자 규칙(예상 완료가 종료일보다 늦은 일수)으로 서버가 조회 때마다 정하고, AI 는 글만 쓴다. 요약이 없으면(AI 를 못 쓰거나 아직 안 만듦) 카드를 그리지 않는다.
// 좁은 폭에서는 머리줄(배지·제목)과 시각 줄이 줄바꿈되어 쌓인다.
import { StatusBadge, type StatusBadgeType } from '@/components/ui/status-badge'
import { formatKstDayClock } from '@/lib/formatters'
import type { ProjectStatusBadge, ProjectStatusSummary } from '@/types/projectOverview'

import { OverviewCard } from '../../me/overview/OverviewCard'

/** 배지별 화면 문구와 공용 상태 배지 종류 — 색은 앱 전체와 같게 StatusBadge 의 의미 매핑(성공·주의·오류)을 따른다. */
const BADGE: Record<ProjectStatusBadge, { label: string; type: StatusBadgeType }> = {
  ON_TRACK: { label: '순조로움', type: 'success' },
  WARN: { label: '주의', type: 'warning' },
  RISK: { label: '위험', type: 'error' },
}

/**
 * 상태 요약 카드. status 가 null 이면 아무것도 그리지 않는다.
 * now 는 「오늘」 판정 기준(테스트가 고정한다) — 기본은 지금.
 */
export function OverviewStatusCard({ status, now = new Date() }: { status: ProjectStatusSummary | null; now?: Date }) {
  if (!status) return null
  const badge = BADGE[status.badge]
  const checked = formatKstDayClock(status.checkedAt, now, '오늘')
  // 다음 점검 시각이 이미 지났으면(실행기가 곧 다시 살핀다 — 5분 주기·처리 상한으로 늦어질 수 있다) 지난 시각을 「다음」으로 보이지 않게 뺀다.
  const nextAt = new Date(status.nextRunAt).getTime()
  const next = nextAt > now.getTime() ? formatKstDayClock(status.nextRunAt, now) : null
  // 시각 줄 — 무효 시각·지난 다음 시각은 그 세그먼트를 뺀다.
  const meta = ['AI 요약', checked && `${checked} 갱신`, next && `다음 ${next}`].filter(Boolean).join(' · ')

  return (
    <OverviewCard className="flex flex-col gap-2" testId="overview-status-card">
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
      {/* 리포트 링크 줄 자리 — 리포트 기능이 생기면 이 아래에 한 줄을 둔다(지금은 그리지 않는다). */}
    </OverviewCard>
  )
}
