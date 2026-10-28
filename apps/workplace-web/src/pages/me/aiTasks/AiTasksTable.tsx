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
import { agentToolLabel, displayState, issueChatPath, primaryWork, progressView } from '@/lib/agentWork'
import { LIST_HEAD_CELL_CLASS } from '@/lib/listStyles'
import { splitByProject } from '@/lib/projectRuns'
import { cn } from '@/lib/utils'
import type { AgentWorkView, IssueResponse } from '@/types/issue'

import { type EpicHead, groupAiTasks } from './aiTaskGroups'
import { EpicHeadTitle } from './EpicHeadTitle'

const DASH = <span className="text-muted-foreground">—</span>

/*
 * 좁은 폭 접기(WP-917) — 표 래퍼(@container/ai) 폭으로 판정한다(사이드바 펼침·접힘에 따라 같은 화면 폭에서도 표 폭이 달라서).
 * 제목 외 고정 칸 합은 45.25rem — 제목 칸 15rem 을 지키려면 60.25rem 미만에서 에이전트 유형(7rem)을 먼저 숨기고,
 * 53.25rem 미만에서 진행률(5rem)을 숨겨 AI 진행 배지에 합친다. th·td(에픽 머리 줄의 빈 칸 포함)가 같은 클래스를 써야 칸이 밀리지 않는다.
 * 최근 보고를 넓히는 기준(11rem → 16rem)도 화면 폭이 아니라 표 폭 65.25rem(= 60.25 + 5)이다 — 앱 레일을 펼친 1440 화면에서도 제목 15rem 이 남게.
 * 3단계 — 진행률을 합친 단계의 고정 칸은 34.75rem(AI 진행이 합친 배지 몫 7.25rem 으로 넓어짐)이라 49.75rem(= 34.75 + 15) 미만에서는
 * 최근 보고를 11rem → 5.5rem 으로 줄인다(한 줄 말줄임 + title 툴팁). 그때 고정 칸 29.25rem — 1024 기본 배치(표 712px = 44.5rem)에서 제목 15.25rem.
 */
const TOOL_COL_CLASS = 'hidden @min-[60.25rem]/ai:table-cell'
const PROGRESS_COL_CLASS = 'hidden @min-[53.25rem]/ai:table-cell'

/** 담당자 칸 — 아바타만(AI 구성원은 아바타의 에이전트 표식으로 구분).
 *  대표 작업 작업자 → 없으면 첫 AI 담당자 → 그 외 첫 담당자. 진행 중 작업이 2건 이상이면 +N. */
export function AiTaskAssignee({ issue, work, testId }: { issue: IssueResponse; work: AgentWorkView | null; testId?: string }) {
  const u = work?.worker ?? issue.assignees.find((a) => a.kind === 'AGENT') ?? issue.assignees[0]
  if (!u) return DASH
  const more = (issue.agentWork?.length ?? 0) - 1
  // 좁은 폭에서 에이전트 유형 칸이 숨어도 도구를 알 수 있게 툴팁에 「이름 · 도구」(WP-917). 도구를 모르면 이름만.
  const tool = work?.tool ? agentToolLabel(work.tool) : null
  const name = u.kind === 'AGENT' ? `${u.name} (에이전트)` : u.name
  const title = tool ? `${name} · ${tool}` : name
  return (
    <span className="inline-flex shrink-0 items-center gap-1" title={title} data-testid={testId}>
      <UserAvatar user={u} size="xs" agent={u.kind === 'AGENT'} title={tool ? title : undefined} />
      {more > 0 && <span className="text-xs text-muted-foreground">+{more}</span>}
    </span>
  )
}

/** AI 진행 6칸(AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고) — 일반 행과 에픽 머리 줄이 함께 쓴다.
 *  it 가 없으면(에픽 자신의 AI 작업이 없는 묶음) 빈 칸 6개. */
function AiCells({ it, tid }: { it: IssueResponse | null; tid: string }) {
  if (!it)
    return (
      <>
        <td /><td /><td className={PROGRESS_COL_CLASS} /><td /><td className={TOOL_COL_CLASS} /><td />
      </>
    )
  const w = primaryWork(it.agentWork)
  const state = displayState(it)
  const to = state === 'INPUT_REQUIRED' ? issueChatPath(it.projectKey, it.number) : undefined
  return (
    <>
      <td>
        {/* 배지 두 벌 — 진행률 칸이 보이는 폭은 상태만, 진행률 칸이 숨는 좁은 폭은 「작업 중 64%」처럼 진행률을 합친 배지(WP-917). */}
        {state ? (
          <>
            <span className="hidden @min-[53.25rem]/ai:inline-flex">
              <AgentStateBadge state={state} to={to} data-testid={`${tid}-state`} />
            </span>
            <span className="inline-flex @min-[53.25rem]/ai:hidden">
              <AgentStateBadge
                state={state}
                to={to}
                suffix={w ? progressView(w)?.text : undefined}
                data-testid={`${tid}-state-compact`}
              />
            </span>
          </>
        ) : DASH}
      </td>
      {/* overflow-hidden — 3단계(5.5rem)에서 줄지 않는 예정 라벨이 옆 칸으로 넘치지 않게 자른다(전체는 각 title 툴팁). */}
      <td className="overflow-hidden pr-4">
        {/* 다음 회차 대기 — 예정 라벨을 최근 보고 앞에 두고 보고는 남는 폭에서 말줄임(한 줄). */}
        <div className="flex min-w-0 items-center gap-1.5">
          {w && <AgentNextRun w={w} className="shrink-0" data-testid={`${tid}-next-run`} />}
          <p className="min-w-0 truncate font-normal text-muted-foreground" title={w?.note ?? undefined} data-testid={`${tid}-note`}>
            {w?.note ?? '—'}
          </p>
        </div>
      </td>
      <td className={PROGRESS_COL_CLASS}>{w ? <AgentProgress w={w} data-testid={`${tid}-progress`} /> : DASH}</td>
      <td className="pr-2"><AiTaskAssignee issue={it} work={w} testId={`${tid}-assignee`} /></td>
      <td className={TOOL_COL_CLASS}>{w?.tool ? <AgentToolChip tool={w.tool} className="max-w-full" data-testid={`${tid}-tool`} /> : DASH}</td>
      <td>{w && w.state !== 'SUBMITTED' ? <AgentLastReport w={w} data-testid={`${tid}-last`} /> : DASH}</td>
    </>
  )
}

/** 일반 행 — inGroup 이면 제목 칸만 들여쓰고 에픽 부모 칩을 숨긴다(이슈 목록 groupBy epic 의 hideEpic 과 같은 규칙). */
function AiTaskRow({ it, inGroup }: { it: IssueResponse; inGroup: boolean }) {
  const tid = `ai-row-${it.id}`
  return (
    <tr className="row-divider hover:bg-accent" data-testid={tid}>
      <td className="py-2.5"><IssueStatusIcon status={it.status} name={it.statusName} color={it.statusColor} /></td>
      <td><IssuePriorityBars priority={it.priority} /></td>
      <td className="font-mono text-muted-foreground">{it.projectKey}-{it.number}</td>
      {/* overflow-hidden — 표 min-w 가 제목 최소 몫을 지키지만, 부모 칩·하위 진행 표시처럼 더 붙는 행이 옆 칸을 덮지 않게 안전망으로 자른다. */}
      <td className="overflow-hidden">
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
    <tr className="row-divider bg-muted/40" data-testid={tid}>
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
    <div className="@container/ai overflow-x-auto" data-testid="ai-tasks-table">
      {/* table-fixed — 제목·최근 보고 두 칸이 남는 폭을 나눠 갖고 말줄임한다(긴 글이 표를 밀어내지 않게). */}
      {/* min-w — 두 칸을 접고도 표가 좁으면(앱 레일을 펼친 1024 등) 제목이 8rem 아래로 줄어 옆 칸을 덮지 않게 가로 스크롤로 넘긴다(WP-917).
          39rem = 3단계까지 접은 고정 칸 29.25rem + 묶음 하위 행 제목 최소 몫 9.75rem
          (들여쓰기 pl-5 1.25 + 유형 아이콘 1 + gap 0.5 + 링크 min-w 6 + pr-4 1) — 이보다 좁으면 링크가 잘리지 않고 말줄임(…)으로 줄어든다. */}
      <table className="w-full min-w-[39rem] table-fixed text-sm">
        <thead>
          {/* 열 머리 모양은 공용 LIST_HEAD_CELL_CLASS(작은 회색·보통 굵기) — 다른 이슈 목록과 같게(WP-917). */}
          <tr className="border-b">
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-7')}><span className="sr-only">상태</span></th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-7')}><span className="sr-only">우선순위</span></th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-[72px]')}>ID</th>
            <th className={LIST_HEAD_CELL_CLASS}>제목</th>
            {/* 진행률을 배지에 합치는 좁은 폭에서는 「검토 필요 100%」가 다음 칸을 덮지 않게 92px → 7.25rem 으로 넓힌다. */}
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-[7.25rem] @min-[53.25rem]/ai:w-[92px]')}>AI 진행</th>
            {/* 묶음 들여쓰기·부모 칩이 들어오는 제목 칸에 폭을 더 준다 — 최근 보고는 고정 폭(말줄임 + title 툴팁).
                표 49.75rem 미만 5.5rem(3단계) · 기본 11rem · 65.25rem 이상은 예정 라벨 몫만큼 16rem. */}
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-[5.5rem] @min-[49.75rem]/ai:w-44 @min-[65.25rem]/ai:w-64')}>최근 보고</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-20', PROGRESS_COL_CLASS)}>진행률</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-16')}>담당자</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-28', TOOL_COL_CLASS)}>에이전트 유형</th>
            <th className={cn(LIST_HEAD_CELL_CLASS, 'w-[72px]')}>{done ? '종료' : '마지막 보고'}</th>
          </tr>
        </thead>
        {/* 구간 key 는 키 + 첫 행 id — 같은 프로젝트가 떨어져 두 번 나와도(이론상) 중복되지 않게. */}
        {splitByProject(items).map((run, i) => {
          const tid = `ai-project-${run.key}-head`
          return (
            <tbody key={`${run.key}-${run.items[0].id}`} data-testid={`ai-project-${run.key}`}>
              <tr className="row-divider" data-testid={tid}>
                {/* 접히는 두 칸(진행률·에이전트 유형)은 colSpan 에 넣지 않고 같은 숨김 클래스의 빈 칸으로 둔다 —
                    colSpan=10 이면 칸이 숨는 폭에서 table-fixed 가 빈 열 2개를 더 만들어 제목 칸 폭을 나눠 가진다(WP-917). */}
                <td colSpan={8} className={cn('pb-2', i === 0 ? 'pt-3' : 'pt-6')}>
                  <ProjectRunHead run={run} tid={tid} />
                </td>
                <td className={PROGRESS_COL_CLASS} />
                <td className={TOOL_COL_CLASS} />
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
