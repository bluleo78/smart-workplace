// AI 위임 작업 「AI별」 보기(WP-1201) — AI 한 명이 한 줄(모바일은 카드)인 명단과 상태별 칩.
// Buildkite 에이전트 목록·콜센터 현황판처럼 「상태 + 그 상태로 있은 시간 · 지금 하는 일 · 맡은 일 자리」를 한눈에 둔다.
// 대표 상태·정렬·건수 판정은 lib/aiRoster.ts(RosterRow), 여기서는 그리기만 한다.
import { Link } from 'react-router-dom'

import type { AiAgentWork } from '@/api/aiAgents'
import { AgentLastReport } from '@/components/ai/agentWork/AgentWorkBits'
import { AiSignalBadge } from '@/components/ai/AiSignalBadge'
import { Badge } from '@/components/ui/badge'
import { AssigneeAvatar } from '@/components/users/UserAvatar'
import { agentStateTone, issueChatPath } from '@/lib/agentWork'
import { ROSTER_LABEL, ROSTER_STATES, type RosterRow, type RosterState, sinceLine } from '@/lib/aiRoster'
import { formatIssueKey } from '@/lib/issueKey'
import { LIST_HEAD_CELL_CLASS } from '@/lib/listStyles'
import { cn } from '@/lib/utils'

import { ToggleChips } from '../aiTasks/ToggleChips'

const DASH = <span className="text-muted-foreground">—</span>

const issuePath = (w: AiAgentWork) => `/projects/${w.projectKey}/issues/${w.number}`

/** 대표 상태 배지 — 작업 행 배지(AgentStateBadge)와 같은 톤: 답변 필요는 AI 신호 채움, 작업 중은 AI 신호 옅게, 막힘 경고,
 *  끊김은 옅은 위험, 기다림은 흐린 윤곽, 쉬는 중은 성공(일손이 남음). */
export function RosterStateBadge({ state, 'data-testid': testId }: { state: RosterState; 'data-testid'?: string }) {
  const label = ROSTER_LABEL[state]
  if (state === 'needs' || state === 'working')
    return <AiSignalBadge variant={state === 'needs' ? 'action' : 'info'} data-testid={testId}>{label}</AiSignalBadge>
  if (state === 'blocked') return <Badge variant="warning" data-testid={testId}>{label}</Badge>
  if (state === 'offline')
    return (
      <Badge variant="outline" className="border-destructive/20 bg-destructive/10 text-destructive" data-testid={testId}>
        {label}
      </Badge>
    )
  if (state === 'idle') return <Badge variant="success" data-testid={testId}>{label}</Badge>
  return <Badge variant="outline" className="text-muted-foreground" data-testid={testId}>{label}</Badge>
}

/** 맡은 일 칩 — 이슈 키를 작업 상태 톤(작업 행 배지와 같다)으로. 누르면 그 이슈(답변 필요는 이슈 챗). 제목·보고는 툴팁. */
function WorkChip({ w, testId }: { w: AiAgentWork; testId: string }) {
  const tone = agentStateTone(w.state)
  const to = w.state === 'INPUT_REQUIRED' ? issueChatPath(w.projectKey, w.number) : issuePath(w)
  const label = formatIssueKey(w.projectKey, w.number)
  const title = `${w.title}${w.note ? ` — ${w.note}` : ''}`
  if (tone === 'action' || tone === 'info')
    return (
      <AiSignalBadge variant={tone} to={to} reason={title} className="font-mono" data-testid={testId}>
        {label}
      </AiSignalBadge>
    )
  return (
    <Badge
      asChild
      variant={tone === 'warning' ? 'warning' : 'outline'}
      className={cn('font-mono', tone !== 'warning' && 'text-muted-foreground')}
    >
      <Link to={to} title={title} data-testid={testId}>
        {label}
      </Link>
    </Badge>
  )
}

/** 자리 막대 — 상한(3) 중 쓰는 자리를 칸으로. 빈 칸이 보이면 더 맡길 수 있다는 뜻. */
function SlotMeter({ used, limit, testId }: { used: number; limit: number; testId: string }) {
  const full = used >= limit
  return (
    <span className="inline-flex items-center gap-1.5" title={`동시 진행 ${used}/${limit}`} data-testid={testId}>
      <span className="inline-flex gap-0.5" aria-hidden>
        {Array.from({ length: limit }, (_, i) => (
          <span key={i} className={cn('h-1.5 w-3 rounded-full', i < used ? (full ? 'bg-warning' : 'bg-primary') : 'bg-muted')} />
        ))}
      </span>
      <span className={cn('text-xs tabular-nums', full ? 'text-warning-text' : 'text-muted-foreground')}>
        {used}/{limit}
      </span>
    </span>
  )
}

/** 맡은 일 — 진행 중 칩들 + 못 보는 프로젝트 건수 + 검토 대기 건수. */
function WorkChips({ row, tid }: { row: RosterRow; tid: string }) {
  const hidden = row.agent.hiddenWorks
  if (row.active.length === 0 && hidden === 0 && row.reviews === 0) return DASH
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.active.map((w) => (
        <WorkChip key={`${w.projectKey}-${w.number}`} w={w} testId={`${tid}-work-${w.projectKey}-${w.number}`} />
      ))}
      {hidden > 0 && (
        <span className="text-xs text-muted-foreground" title="볼 수 없는 프로젝트의 작업" data-testid={`${tid}-hidden`}>
          +다른 프로젝트 {hidden}
        </span>
      )}
      {row.reviews > 0 && (
        <span className="text-xs text-muted-foreground" data-testid={`${tid}-reviews`}>검토 대기 {row.reviews}</span>
      )}
    </div>
  )
}

/** 이름 칸 — 아바타(연결 점) + 이름 + 설명 첫 줄. 연결 점은 외부 AI 만(서버 안 AI 는 판단하지 않는다). */
function AgentName({ row, tid }: { row: RosterRow; tid: string }) {
  const a = row.agent
  const role = a.description?.split('\n')[0]?.trim()
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="relative shrink-0">
        <AssigneeAvatar user={a.agent} size="sm" />
        {a.connected !== null && (
          <span
            className={cn(
              'absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
              a.connected ? 'bg-success' : 'bg-destructive',
            )}
            title={a.connected ? '연결됨' : '연결 끊김'}
            data-testid={`${tid}-live`}
            data-connected={a.connected}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{a.agent.name}</span>
        {role && <span className="truncate text-xs text-muted-foreground" title={role}>{role}</span>}
      </span>
    </div>
  )
}

/** 지금 하는 일 — 대표 작업의 키·제목과 한 줄 보고. 쉬는 중이면 「맡은 일 없음」. */
function LeadWork({ row, tid }: { row: RosterRow; tid: string }) {
  const w = row.lead
  if (!w) return <span className="text-muted-foreground" data-testid={`${tid}-lead`}>맡은 일 없음</span>
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={`${tid}-lead`}>
      <Link to={issuePath(w)} className="flex min-w-0 items-baseline gap-2 hover:underline" title={w.title}>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatIssueKey(w.projectKey, w.number)}</span>
        <span className="truncate font-medium">{w.title}</span>
      </Link>
      {w.note && <span className="truncate text-xs text-muted-foreground" title={w.note}>{w.note}</span>}
    </div>
  )
}

/** 상태 칸 — 대표 상태 배지 + 「n분째」. 모바일 카드는 오른쪽 정렬(align=end). */
function StateCell({ row, tid, now, align = 'start' }: { row: RosterRow; tid: string; now: number; align?: 'start' | 'end' }) {
  const line = sinceLine(row, now)
  return (
    <div className={cn('flex flex-col gap-1', align === 'end' ? 'shrink-0 items-end' : 'items-start')}>
      <RosterStateBadge state={row.state} data-testid={`${tid}-state`} />
      {line && <span className="text-xs text-muted-foreground" data-testid={`${tid}-since`}>{line}</span>}
    </div>
  )
}

/** 마지막 보고 — 가장 최근에 보고한 작업 행 그대로(무소식이면 경고색). */
function LastReport({ row, tid }: { row: RosterRow; tid: string }) {
  return row.latest ? <AgentLastReport w={row.latest} data-testid={`${tid}-last`} /> : DASH
}

const rowTid = (row: RosterRow) => `ai-agent-${row.agent.agent.id}`

/** 데스크톱 표 — 열: AI · 상태 · 지금 하는 일 · 맡은 일 · 자리 · 마지막 보고. */
export function AiRosterTable({ rows, limit, now }: { rows: RosterRow[]; limit: number; now: number }) {
  return (
    <div className="overflow-x-auto" data-testid="ai-roster-table">
      <table className="w-full min-w-[52rem] table-fixed text-sm">
        <thead>
          <tr className="border-b">
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-52')}>AI</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-36')}>상태</th>
            <th className={LIST_HEAD_CELL_CLASS}>지금 하는 일</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-60')}>맡은 일</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-24')}>자리</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-24')}>마지막 보고</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const tid = rowTid(row)
            return (
              <tr key={row.agent.agent.id} className="row-divider align-top hover:bg-accent" data-testid={tid}>
                <td className="py-3 pr-3"><AgentName row={row} tid={tid} /></td>
                <td className="py-3 pr-3"><StateCell row={row} tid={tid} now={now} /></td>
                <td className="overflow-hidden py-3 pr-4"><LeadWork row={row} tid={tid} /></td>
                <td className="py-3 pr-3"><WorkChips row={row} tid={tid} /></td>
                <td className="py-3"><SlotMeter used={row.agent.slotsUsed} limit={limit} testId={`${tid}-slots`} /></td>
                <td className="py-3"><LastReport row={row} tid={tid} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 모바일 카드 — 머리(이름·상태) · 지금 하는 일 · 맡은 일 + 자리 · 마지막 보고. */
export function AiRosterMobileList({ rows, limit, now }: { rows: RosterRow[]; limit: number; now: number }) {
  return (
    <ul className="divide-y rounded-lg border bg-card" data-testid="ai-roster-mobile">
      {rows.map((row) => {
        const tid = rowTid(row)
        return (
          <li key={row.agent.agent.id} className="space-y-2 p-3" data-testid={tid}>
            <div className="flex items-start justify-between gap-2">
              <AgentName row={row} tid={tid} />
              <StateCell row={row} tid={tid} now={now} align="end" />
            </div>
            <LeadWork row={row} tid={tid} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <WorkChips row={row} tid={tid} />
              <span className="flex items-center gap-3">
                <SlotMeter used={row.agent.slotsUsed} limit={limit} testId={`${tid}-slots`} />
                <LastReport row={row} tid={tid} />
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** 상태별 칩 — 이슈별 보기의 빠른 필터 칩과 같은 칩 줄(ToggleChips). 켜진 칩을 다시 누르면 해제(전체). */
export function AiRosterChips({
  state,
  counts,
  onChange,
}: {
  state: RosterState | null
  counts?: Record<RosterState | 'all', number>
  onChange: (s: RosterState | null) => void
}) {
  const chips = [
    { key: 'all' as const, label: '전체', on: state === null, count: counts?.all, onClick: () => onChange(null) },
    ...ROSTER_STATES.map((s) => ({
      key: s,
      label: ROSTER_LABEL[s],
      on: state === s,
      count: counts?.[s],
      onClick: () => onChange(state === s ? null : s),
    })),
  ]
  return <ToggleChips chips={chips} label="AI 상태" testIds={{ row: 'ai-roster-chips', chip: 'ai-roster-chip', count: 'ai-roster-count' }} />
}
