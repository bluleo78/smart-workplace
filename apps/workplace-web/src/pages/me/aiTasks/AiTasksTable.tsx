// AI 위임 작업 데스크톱 표(WP-377) — 공유 IssueListTable 대신 이 화면 전용(내 작업 화면 무영향).
// 이 화면은 분류 화면: 이슈 상태·우선순위는 프로젝트 이슈 목록처럼 앞쪽 아이콘으로 낮추고, AI 진행 정보를 본문으로 둔다.
// 행 순서는 서버가 준 급한 순 그대로(클라이언트 재정렬 금지 — 무한 스크롤 페이지 경계와 어긋나지 않게).
// 에픽 묶음은 서버가 묶음 단위로 정렬해 연속으로 준다(WP-375) — 화면은 묶음 머리 + 들여쓴 하위 행으로 그린다.
import { Layers } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import {
  AgentLastReport,
  AgentProgress,
  AgentStateBadge,
  AgentToolChip,
} from '@/components/ai/agentWork/AgentWorkBits'
import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import { ParentChip } from '@/components/issues/ParentChip'
import { IssueTypeBadge } from '@/components/issueTypes/IssueTypeBadge'
import { UserAvatar } from '@/components/users/UserAvatar'
import { displayState, primaryWork } from '@/lib/agentWork'
import { labelFg } from '@/lib/labelColors'
import { cn } from '@/lib/utils'
import type { AgentWorkView, IssueResponse } from '@/types/issue'

import { type EpicHead, groupAiTasks } from './aiTaskGroups'

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

/** 하위 진행 └ done/total — 이슈 목록 행(IssueListRow)과 같은 모양. */
function ChildProgress({ done, total, testId }: { done: number | null; total: number | null; testId: string }) {
  if (!total) return null
  return (
    <span className="shrink-0 text-xs font-normal text-muted-foreground" data-testid={testId} aria-label={`하위 작업 ${done ?? 0}/${total}`}>
      └ {done ?? 0}/{total}
    </span>
  )
}

/** AI 진행 6칸(AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고) — 일반 행과 에픽 머리 줄이 함께 쓴다.
 *  it 가 없으면(에픽 자신의 AI 작업이 없는 묶음) 빈 칸 6개. */
function AiCells({ it, tid }: { it: IssueResponse | null; tid: string }) {
  if (!it) return <><td /><td /><td /><td /><td /><td /></>
  const w = primaryWork(it.agentWork)
  const state = displayState(it)
  return (
    <>
      <td>{state ? <AgentStateBadge state={state} data-testid={`${tid}-state`} /> : DASH}</td>
      <td className="pr-4">
        <p className="truncate font-normal text-muted-foreground" title={w?.note ?? undefined} data-testid={`${tid}-note`}>
          {w?.note ?? '—'}
        </p>
      </td>
      <td>{w ? <AgentProgress w={w} data-testid={`${tid}-progress`} /> : DASH}</td>
      <td className="pr-2"><AiTaskAssignee issue={it} work={w} /></td>
      <td>{w?.tool ? <AgentToolChip tool={w.tool} className="max-w-full" data-testid={`${tid}-tool`} /> : DASH}</td>
      <td>{w && w.state !== 'SUBMITTED' ? <AgentLastReport w={w} data-testid={`${tid}-last`} /> : DASH}</td>
    </>
  )
}

/** 일반 행 — inGroup 이면 제목 칸만 들여쓰고 에픽 부모 칩을 숨긴다(이슈 목록 groupBy epic 의 hideEpic 과 같은 규칙). */
function AiTaskRow({ it, inGroup }: { it: IssueResponse; inGroup: boolean }) {
  const tid = `ai-row-${it.id}`
  return (
    <tr className="border-b hover:bg-accent" data-testid={tid}>
      <td className="py-2.5"><IssueStatusIcon status={it.status} /></td>
      <td><IssuePriorityBars priority={it.priority} /></td>
      <td className="font-mono text-muted-foreground">{it.projectKey}-{it.number}</td>
      <td>
        <div className={cn('flex min-w-0 items-center gap-2 pr-4', inGroup && 'pl-5')}>
          {it.type && (
            <span className="shrink-0"><IssueTypeBadge type={it.type} size="sm" iconOnly /></span>
          )}
          {/* 부모 칩이 붙는 행은 제목을 줄이지 않고(칩 최소 5rem 만 남김) 칩이 남는 폭에서 말줄임된다. */}
          <Link
            to={`/projects/${it.projectKey}/issues/${it.number}`}
            className={cn('min-w-[6rem] truncate font-medium hover:underline', it.parent && !inGroup && 'shrink-0 max-w-[calc(100%-5rem)]')}
            title={it.title}
          >
            {it.title}
          </Link>
          <ChildProgress done={it.childDoneCount} total={it.childCount} testId={`${tid}-child-progress`} />
          {it.parent && !inGroup && (
            <span className="ml-auto flex min-w-0 justify-end overflow-hidden">
              <ParentChip projectKey={it.projectKey} parent={it.parent} issueNumber={it.number} showKey />
            </span>
          )}
        </div>
      </td>
      <AiCells it={it} tid={tid} />
    </tr>
  )
}

/** 에픽 묶음 머리 줄 — 앞 4칸(상태·우선순위·ID·제목)을 합쳐 「Layers · 키 · 제목 · └ n/m」, 뒤 6칸은 에픽 자신의 AI 작업(없으면 비움). */
function EpicHeadRow({ epic, head }: { epic: EpicHead; head: IssueResponse | null }) {
  const tid = `ai-epic-${epic.number}`
  return (
    <tr className="border-b bg-muted/40" data-testid={tid}>
      <td colSpan={4} className="py-2">
        <div className="flex min-w-0 items-center gap-1.5 pr-4">
          <Layers className={cn('size-4 shrink-0', (epic.type ? labelFg(epic.type.colorToken) : 'text-muted-foreground'))} aria-hidden="true" />
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{epic.projectKey}-{epic.number}</span>
          <Link to={`/projects/${epic.projectKey}/issues/${epic.number}`} className="min-w-0 truncate font-semibold hover:underline" title={epic.title}>
            {epic.title}
          </Link>
          <ChildProgress done={epic.childDoneCount} total={epic.childCount} testId={`${tid}-child-progress`} />
        </div>
      </td>
      <AiCells it={head} tid={head ? `ai-row-${head.id}` : tid} />
    </tr>
  )
}

export function AiTasksTable({ items }: { items: IssueResponse[] }) {
  const entries = groupAiTasks(items)
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
            {/* 묶음 들여쓰기·부모 칩이 들어오는 제목 칸에 폭을 더 준다 — 최근 보고는 고정 폭(말줄임 + title 툴팁). */}
            <th className="w-44">최근 보고</th>
            <th className="w-20">진행률</th>
            <th className="w-16">담당자</th>
            <th className="w-28">에이전트 유형</th>
            <th className="w-[72px]">마지막 보고</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) =>
            e.kind === 'row' ? (
              <AiTaskRow key={e.issue.id} it={e.issue} inGroup={false} />
            ) : (
              <Fragment key={e.key}>
                <EpicHeadRow epic={e.epic} head={e.head} />
                {e.children.map((c) => <AiTaskRow key={c.id} it={c} inGroup />)}
              </Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  )
}
