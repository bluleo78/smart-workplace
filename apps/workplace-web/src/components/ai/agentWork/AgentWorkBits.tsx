// AI 작업 진행 표시 부품(WP-377) — 상태 배지·도구 칩·진행률·마지막 보고. 계산은 lib/agentWork.ts 에 있다.
import { AlertTriangle } from 'lucide-react'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { relTime } from '@/components/ai/relTime'
import { Badge } from '@/components/ui/badge'
import { AGENT_STATE_LABEL, agentStateTone, agentToolLabel, progressView, STALE_TOOLTIP } from '@/lib/agentWork'
import { cn } from '@/lib/utils'
import type { AgentWorkState, AgentWorkView } from '@/types/issue'

/** AI 진행 배지 — 톤은 agentStateTone: 사람이 할 일은 AI 판단신호 action(채움), 작업 중 info, 막힘 경고, 완료 성공·실패 위험(WP-396), 그 외(일시 중지·시작 전·취소·반려)는 흐린 윤곽. */
export function AgentStateBadge({
  state,
  'data-testid': testId,
}: {
  state: AgentWorkState | 'NOT_STARTED'
  'data-testid'?: string
}) {
  const label = AGENT_STATE_LABEL[state]
  const tone = agentStateTone(state)
  if (tone === 'action' || tone === 'info') return <AiSignalBadge variant={tone} data-testid={testId}>{label}</AiSignalBadge>
  if (tone === 'muted') return <Badge variant="outline" className="text-muted-foreground" data-testid={testId}>{label}</Badge>
  // 실패 — Badge 에 옅은 위험 variant 가 없어 success·warning 과 같은 결(/10 바탕·/20 테두리)의 tint 를 디자인 토큰으로 입힌다(진한 destructive 채움은 과하다).
  if (tone === 'destructive')
    return (
      <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive" data-testid={testId}>
        {label}
      </Badge>
    )
  return <Badge variant={tone} data-testid={testId}>{label}</Badge>
}

/** 에이전트 유형 칩 — Claude Code·Cursor 등 실제로 일하는 AI 도구. 도구를 아직 모르면(시작 전) 아무것도 그리지 않는다.
 *  좁은 줄에서 먼저 줄어들 수 있게 className(min-w-0 shrink 등)을 받고, 글자는 안쪽 span 이 말줄임한다
 *  (flex 컨테이너 자신의 글자에는 말줄임이 걸리지 않는다). */
export function AgentToolChip({
  tool,
  className,
  'data-testid': testId,
}: {
  tool: string | null
  className?: string
  'data-testid'?: string
}) {
  if (!tool) return null
  const label = agentToolLabel(tool)
  return (
    <Badge variant="secondary" className={cn('font-normal', className)} title={label} data-testid={testId}>
      <span className="truncate">{label}</span>
    </Badge>
  )
}

/** 진행률 막대 + 글자 — 진행 정보가 없으면 hideEmpty 일 때 숨기고 아니면 —. variant 'text' 면 막대 없이 글자만(좁은 모바일 메타 줄). */
export function AgentProgress({
  w,
  className,
  variant = 'bar',
  hideEmpty,
  'data-testid': testId,
}: {
  w: Pick<AgentWorkView, 'progress' | 'stepsDone' | 'stepsTotal'>
  className?: string
  variant?: 'bar' | 'text'
  hideEmpty?: boolean
  'data-testid'?: string
}) {
  const v = progressView(w)
  if (!v) return hideEmpty ? null : <span className="text-muted-foreground" data-testid={testId}>—</span>
  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-testid={testId}>
      {variant === 'bar' && (
        <span className="h-1.5 w-8 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${v.pct}%` }} />
        </span>
      )}
      <span className="text-xs tabular-nums text-muted-foreground">{v.text}</span>
    </span>
  )
}

/**
 * 마지막 보고 시각 — 작업 중인데 2시간 넘게 소식 없으면 경고색 + 아이콘. 시작 전(SUBMITTED)은 아직 아무 보고가 없으므로 그리지 않는다(updatedAt 은 행 생성 시각일 뿐).
 * 종료 작업(endedAt 있음, 완료 보기 WP-396)은 마지막 보고 대신 종료 시각을 보인다 — 목록이 종료 시각순이라 칸과 정렬이 맞도록. 판정은 행마다이고
 * 툴팁에 「종료」/「마지막 보고」를 밝히며,
 * 칸 제목이 없는 곳(모바일 메타 줄)은 endedLabel 로 글자에도 「종료」를 붙인다.
 */
export function AgentLastReport({
  w,
  className,
  endedLabel,
  'data-testid': testId,
}: {
  w: Pick<AgentWorkView, 'updatedAt' | 'stale' | 'state' | 'endedAt'>
  className?: string
  endedLabel?: boolean
  'data-testid'?: string
}) {
  if (w.state === 'SUBMITTED') return null
  if (w.stale)
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs text-warning-text', className)}
        title={STALE_TOOLTIP}
        data-testid={testId}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden />
        {relTime(w.updatedAt)}
      </span>
    )
  // 종료 여부는 행마다 endedAt 으로 정한다 — 완료 보기(칸 제목 「종료」)에서도 조회 사이 다시 시작된 행은 마지막 보고 시각이라 툴팁으로 구분한다.
  const rel = relTime(w.endedAt ?? w.updatedAt)
  const kind = w.endedAt ? '종료' : '마지막 보고'
  return (
    <span className={cn('text-xs text-muted-foreground', className)} title={`${kind} ${rel}`} data-testid={testId}>
      {w.endedAt && endedLabel ? `종료 ${rel}` : rel}
    </span>
  )
}
