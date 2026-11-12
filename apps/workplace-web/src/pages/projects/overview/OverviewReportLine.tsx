// 개요 「프로젝트 상태」 카드 아래 리포트 줄(WP-1483) — 「주간 리포트 · 11월 16일 (월) 09:00 · 한 줄」 + 오른쪽 「리포트 전체 보기」 · 「지난 리포트 ▾」.
// 한 줄·배지는 서버가 리포트 노트 본문에서 그때 읽는다(사람이 노트에서 고치면 여기도 바뀐다). 전문은 프로젝트 노트 탭에서 연다.
// 좁은 폭에서는 링크 묶음이 다음 줄로 내려간다(flex-wrap).
import { ChevronDown } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatKstMonthDayWeekdayClock } from '@/lib/formatters'
import { cn } from '@/lib/utils'
import type { ProjectReportCardResponse } from '@/types/projectReport'

import { projectNotePath } from '../tabs/projectTabs'
import { PROJECT_STATUS_BADGE } from './projectStatusBadge'

/** 오른쪽 링크·「지난 리포트」 트리거 공통 — 누르는 높이와 초점 고리(focus-visible ring 토큰). */
const actionClass =
  'inline-flex min-h-8 items-center rounded-sm px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

/**
 * 리포트 줄. 최신 리포트가 없으면(노트 공간 비멤버·아직 없음·불러오지 못함) 아무것도 그리지 않는다.
 * now 는 연도 판정 기준(테스트가 고정한다) — 기본은 지금.
 */
export function OverviewReportLine({
  report,
  projectKey,
  now = new Date(),
}: {
  report: ProjectReportCardResponse | null | undefined
  projectKey: string
  now?: Date
}) {
  const latest = report?.latest
  if (!report || !latest) return null
  const name = `${report.cadenceLabel ?? '주간'} 리포트`
  // 세그먼트: 이름 · 만든 시각 · 한 줄 — 무효 시각·빈 한 줄은 뺀다.
  const when = formatKstMonthDayWeekdayClock(latest.createdAt, now)

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="overview-report-line">
      <p className="min-w-0 flex-1 break-words" data-testid="overview-report-summary">
        <span className="font-medium">{name}</span>
        {when && <span className="text-muted-foreground"> · {when}</span>}
        {latest.line && <span> · {latest.line}</span>}
      </p>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        {/* 링크·트리거는 손가락으로 누르기 쉬운 높이(min-h-8)와 키보드 초점 고리(개요 다른 링크와 같은 ring 토큰)를 둔다. */}
        <Link to={projectNotePath(projectKey, latest.pageId)} className={actionClass}>
          리포트 전체 보기
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(actionClass, 'gap-0.5')} data-testid="overview-report-past">
            지난 리포트
            <ChevronDown className="size-3" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {report.past.map((item) => {
              const badge = item.badge ? PROJECT_STATUS_BADGE[item.badge] : null
              return (
                <DropdownMenuItem key={item.pageId} asChild>
                  <Link to={projectNotePath(projectKey, item.pageId)} className="flex items-center gap-2" data-testid="overview-report-past-item">
                    {badge && (
                      <StatusBadge type={badge.type} className="shrink-0">
                        {badge.label}
                      </StatusBadge>
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {/* 최신 회차·사람이 고친 리포트 표시 — 글자로(색 단독 의존 금지). */}
                    {item.pageId === latest.pageId && <span className="shrink-0 text-xs text-muted-foreground">이번 회차</span>}
                    {item.edited && <span className="shrink-0 text-xs text-muted-foreground">수정됨</span>}
                  </Link>
                </DropdownMenuItem>
              )
            })}
            {report.reportsPageId != null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={projectNotePath(projectKey, report.reportsPageId)} className="text-primary">
                    노트에서 모두 보기
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
