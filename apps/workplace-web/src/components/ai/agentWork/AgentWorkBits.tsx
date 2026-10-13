// AI 작업 진행 표시 부품(WP-377) — 상태 배지·도구 칩·진행률·마지막 보고. 계산은 lib/agentWork.ts 에 있다.
import { AlertTriangle } from 'lucide-react'

import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { relTime } from '@/components/ai/relTime'
import { Badge } from '@/components/ui/badge'
import { AGENT_STATE_LABEL, agentToolLabel, progressView, STALE_TOOLTIP } from '@/lib/agentWork'
import { cn } from '@/lib/utils'
import type { AgentWorkState, AgentWorkView } from '@/types/issue'

/** AI 진행 배지 — 사용자 행동이 필요한 상태는 AI 판단신호 action(채움), 진행 정보는 info, 막힘은 경고, 그 외는 흐린 윤곽. */
export function AgentStateBadge({
  state,
  'data-testid': testId,
}: {
  state: AgentWorkState | 'NOT_STARTED'
  'data-testid'?: string
}) {
  const label = AGENT_STATE_LABEL[state]
  if (state === 'WAITING' || state === 'REVIEW')
    return <AiSignalBadge variant="action" data-testid={testId}>{label}</AiSignalBadge>
  if (state === 'WORKING') return <AiSignalBadge variant="info" data-testid={testId}>{label}</AiSignalBadge>
  if (state === 'BLOCKED') return <Badge variant="warning" data-testid={testId}>{label}</Badge>
  return <Badge variant="outline" className="text-muted-foreground" data-testid={testId}>{label}</Badge>
}

/** 에이전트 유형 칩 — Claude Code·Cursor 등 실제로 일하는 AI 도구.
 *  좁은 줄에서 먼저 줄어들 수 있게 className(min-w-0 shrink 등)을 받고, 글자는 안쪽 span 이 말줄임한다
 *  (flex 컨테이너 자신의 글자에는 말줄임이 걸리지 않는다). */
export function AgentToolChip({
  tool,
  className,
  'data-testid': testId,
}: {
  tool: string
  className?: string
  'data-testid'?: string
}) {
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

/** 마지막 보고 시각 — 작업 중인데 2시간 넘게 소식 없으면 경고색 + 아이콘. */
export function AgentLastReport({
  w,
  className,
  'data-testid': testId,
}: {
  w: Pick<AgentWorkView, 'updatedAt' | 'stale'>
  className?: string
  'data-testid'?: string
}) {
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
  return (
    <span className={cn('text-xs text-muted-foreground', className)} data-testid={testId}>
      {relTime(w.updatedAt)}
    </span>
  )
}
