// AI 위임 작업 데스크톱 표(WP-377) — 공유 IssueListTable 대신 이 화면 전용(내 작업 화면 무영향).
// 이 화면은 분류 화면: 이슈 상태·우선순위는 프로젝트 이슈 목록처럼 앞쪽 아이콘으로 낮추고, AI 진행 정보를 본문으로 둔다.
// 행 순서는 서버가 준 급한 순 그대로(클라이언트 재정렬 금지 — 무한 스크롤 페이지 경계와 어긋나지 않게).
import { Link } from 'react-router-dom'

import {
  AgentLastReport,
  AgentProgress,
  AgentStateBadge,
  AgentToolChip,
} from '@/components/ai/agentWork/AgentWorkBits'
import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import { IssueTypeBadge } from '@/components/issueTypes/IssueTypeBadge'
import { UserAvatar } from '@/components/users/UserAvatar'
import { displayState, primaryWork } from '@/lib/agentWork'
import type { AgentWorkView, IssueResponse } from '@/types/issue'

const DASH = <span className="text-muted-foreground">—</span>

/** 담당자 칸 — 아바타만(AI 구성원은 아바타의 에이전트 표식으로 구분).
 *  대표 작업 작업자 → 없으면 첫 AI 담당자 → 그 외 첫 담당자. 진행 중 작업이 2건 이상이면 +N. */
export function AiTaskAssignee({ issue, work }: { issue: IssueResponse; work: AgentWorkView | null }) {
  const u = work?.worker ?? issue.assignees.find((a) => a.kind === 'AGENT') ?? issue.assignees[0]
  if (!u) return DASH
  const more = (issue.agentWork?.length ?? 0) - 1
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <UserAvatar user={u} size="xs" agent={u.kind === 'AGENT'} />
      {more > 0 && <span className="text-xs text-muted-foreground">+{more}</span>}
    </span>
  )
}

export function AiTasksTable({ items }: { items: IssueResponse[] }) {
  return (
    <div className="overflow-x-auto" data-testid="ai-tasks-table">
      {/* table-fixed — 제목·최근 보고 두 칸이 남는 폭을 나눠 갖고 말줄임한다(긴 글이 표를 밀어내지 않게). */}
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="w-7 py-2"><span className="sr-only">상태</span></th>
            <th className="w-7"><span className="sr-only">우선순위</span></th>
            <th className="w-[72px]">ID</th>
            <th>제목</th>
            <th className="w-[92px]">AI 진행</th>
            <th>최근 보고</th>
            <th className="w-20">진행률</th>
            <th className="w-16">담당자</th>
            <th className="w-28">에이전트 유형</th>
            <th className="w-[72px]">마지막 보고</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const w = primaryWork(it.agentWork)
            const state = displayState(it)
            const tid = `ai-row-${it.id}`
            return (
              <tr key={it.id} className="border-b hover:bg-accent" data-testid={tid}>
                <td className="py-2.5"><IssueStatusIcon status={it.status} /></td>
                <td><IssuePriorityBars priority={it.priority} /></td>
                <td className="font-mono text-muted-foreground">{it.projectKey}-{it.number}</td>
                <td>
                  <div className="flex min-w-0 items-center gap-2 pr-4">
                    {it.type && (
                      <span className="shrink-0"><IssueTypeBadge type={it.type} size="sm" iconOnly /></span>
                    )}
                    <Link to={`/projects/${it.projectKey}/issues/${it.number}`} className="truncate font-medium hover:underline" title={it.title}>
                      {it.title}
                    </Link>
                  </div>
                </td>
                <td>{state ? <AgentStateBadge state={state} data-testid={`${tid}-state`} /> : DASH}</td>
                <td className="pr-4">
                  <p className="truncate text-muted-foreground" title={w?.note ?? undefined} data-testid={`${tid}-note`}>
                    {w?.note ?? '—'}
                  </p>
                </td>
                <td>{w ? <AgentProgress w={w} data-testid={`${tid}-progress`} /> : DASH}</td>
                <td className="pr-2"><AiTaskAssignee issue={it} work={w} /></td>
                <td>{w ? <AgentToolChip tool={w.tool} className="max-w-full" data-testid={`${tid}-tool`} /> : DASH}</td>
                <td>{w ? <AgentLastReport w={w} data-testid={`${tid}-last`} /> : DASH}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
