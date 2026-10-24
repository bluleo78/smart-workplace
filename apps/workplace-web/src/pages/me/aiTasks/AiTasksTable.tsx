// AI 위임 작업 데스크톱 표(WP-377) — 공유 IssueListTable 대신 이 화면 전용(내 작업 화면 무영향).
// 이 화면은 분류 화면: 이슈 상태·우선순위는 프로젝트 이슈 목록처럼 앞쪽 아이콘으로 낮추고, AI 진행 정보를 본문으로 둔다.
// 행 순서는 서버가 준 급한 순 그대로(클라이언트 재정렬 금지 — 무한 스크롤 페이지 경계와 어긋나지 않게).
// 프로젝트별 구간(WP-426): 서버가 프로젝트 단위로 이어 준 행을 머리 줄(배지·이름·키 · 건수) 아래에 묶어 그린다.
// 에픽 묶음은 서버가 묶음 단위로 정렬해 연속으로 준다(WP-375) — 화면은 묶음 머리 + 들여쓴 하위 행으로 그린다.
import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import {
  AgentLastReport,
  AgentNextRun,
  AgentProgress,
  AgentStateBadge,
  AgentToolChip,
} from '@/components/ai/agentWork/AgentWorkBits'
import { ProjectRunHead } from '@/components/issue/ProjectRunHead'
import { ChildProgress } from '@/components/issues/ChildProgress'
import { IssuePriorityBars } from '@/components/issues/IssuePriorityBars'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import { ParentChip } from '@/components/issues/ParentChip'
import { IssueTypeBadge } from '@/components/issueTypes/IssueTypeBadge'
import { UserAvatar } from '@/components/users/UserAvatar'
import { displayState, issueChatPath, primaryWork } from '@/lib/agentWork'
import { splitByProject } from '@/lib/projectRuns'
import { cn } from '@/lib/utils'
import type { AgentWorkView, IssueResponse } from '@/types/issue'

import { type EpicHead, groupAiTasks } from './aiTaskGroups'
import { EpicHeadTitle } from './EpicHeadTitle'

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

/** AI 진행 6칸(AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고) — 일반 행과 에픽 머리 줄이 함께 쓴다.
 *  it 가 없으면(에픽 자신의 AI 작업이 없는 묶음) 빈 칸 6개. */
function AiCells({ it, tid }: { it: IssueResponse | null; tid: string }) {
  if (!it) return <><td /><td /><td /><td /><td /><td /></>
  const w = primaryWork(it.agentWork)
  const state = displayState(it)
  return (
    <>
      <td>
        {state ? (
          <AgentStateBadge
            state={state}
            to={state === 'INPUT_REQUIRED' ? issueChatPath(it.projectKey, it.number) : undefined}
            data-testid={`${tid}-state`}
          />
        ) : DASH}
      </td>
      <td className="pr-4">
        {/* 다음 회차 대기 — 예정 라벨을 최근 보고 앞에 두고 보고는 남는 폭에서 말줄임(한 줄). */}
        <div className="flex min-w-0 items-center gap-1.5">
          {w && <AgentNextRun w={w} className="shrink-0" data-testid={`${tid}-next-run`} />}
          <p className="min-w-0 truncate font-normal text-muted-foreground" title={w?.note ?? undefined} data-testid={`${tid}-note`}>
            {w?.note ?? '—'}
          </p>
        </div>
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
      <td className="py-2.5"><IssueStatusIcon status={it.status} name={it.statusName} color={it.statusColor} /></td>
      <td><IssuePriorityBars priority={it.priority} /></td>
      <td className="font-mono text-muted-foreground">{it.projectKey}-{it.number}</td>
      <td>
        <div className={cn('flex min-w-0 items-center gap-2 pr-4', inGroup && 'pl-5')}>
          {it.type && (
            <span className="shrink-0"><IssueTypeBadge type={it.type} size="sm" iconOnly /></span>
          )}
          {/* 부모 칩이 붙는 행은 제목을 줄이지 않고 칩 몫으로 9rem 을 남긴다(키 뒤에 부모 제목 앞 글자가 보이게). */}
          <Link
            to={`/projects/${it.projectKey}/issues/${it.number}`}
            className={cn('min-w-[6rem] truncate font-medium hover:underline', it.parent && !inGroup && 'shrink-0 max-w-[calc(100%-9rem)]')}
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
          <EpicHeadTitle epic={epic} tid={tid} />
        </div>
      </td>
      <AiCells it={head} tid={head ? `ai-row-${head.id}` : tid} />
    </tr>
  )
}

/** done — 완료 보기(WP-396): 마지막 칸이 마지막 보고 대신 종료 시각이라 칸 제목을 「종료」로 바꾼다. */
export function AiTasksTable({ items, done = false }: { items: IssueResponse[]; done?: boolean }) {
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
            {/* 묶음 들여쓰기·부모 칩이 들어오는 제목 칸에 폭을 더 준다 — 최근 보고는 고정 폭(말줄임 + title 툴팁). 1440px 이상은 예정 라벨 몫만큼 넓힌다. */}
            <th className="w-44 min-[1440px]:w-64">최근 보고</th>
            <th className="w-20">진행률</th>
            <th className="w-16">담당자</th>
            <th className="w-28">에이전트 유형</th>
            <th className="w-[72px]">{done ? '종료' : '마지막 보고'}</th>
          </tr>
        </thead>
        {/* 구간 key 는 키 + 첫 행 id — 같은 프로젝트가 떨어져 두 번 나와도(이론상) 중복되지 않게. */}
        {splitByProject(items).map((run, i) => {
          const tid = `ai-project-${run.key}-head`
          return (
            <tbody key={`${run.key}-${run.items[0].id}`} data-testid={`ai-project-${run.key}`}>
              <tr className="border-b" data-testid={tid}>
                <td colSpan={10} className={cn('pb-2', i === 0 ? 'pt-3' : 'pt-6')}>
                  <ProjectRunHead run={run} tid={tid} />
                </td>
              </tr>
              {groupAiTasks(run.items).map((e) =>
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
          )
        })}
      </table>
    </div>
  )
}
