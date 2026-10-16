// AI 위임 작업 모바일 목록(WP-377) — 프로젝트 이슈 목록 모바일 행(IssueRowMobileCell)과 같은 구조:
// 1줄 상태 아이콘 + 제목(2줄) / 2줄 메타(키 · AI 진행 · 에이전트 유형 · 진행률 · 마지막 보고 … 담당자) / 3줄 최근 보고(한 줄).
// 메타 줄은 잘리지도 말줄임되지도 않는다 — 진행률은 막대 없이 글자만 두고, 그래도 폭이 모자라면(긴 상태+진행률+시각)
// 뒤쪽 항목이 다음 줄로 넘어간다(에이전트 유형·마지막 보고는 항상 전체 글자).
// 프로젝트 구간(WP-426): 서버가 프로젝트 단위로 이어 준 행을 프로젝트 머리(배지·이름·키 · 건수) 아래에 묶어 그린다.
// 에픽 묶음(WP-375): 서버가 묶음 단위로 정렬해 준 행을 머리(아이콘·키·제목·└ n/m) 아래에 이어 그린다. 하위 행은 기존 행 그대로.
import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import {
  AgentLastReport,
  AgentProgress,
  AgentStateBadge,
  AgentToolChip,
} from '@/components/ai/agentWork/AgentWorkBits'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import { displayState, primaryWork } from '@/lib/agentWork'
import { cn } from '@/lib/utils'
import type { IssueResponse } from '@/types/issue'

import { type EpicHead, groupAiTasks, splitByProject } from './aiTaskGroups'
import { AiTaskAssignee } from './AiTasksTable'
import { EpicHeadTitle } from './EpicHeadTitle'
import { ProjectHeadTitle } from './ProjectHeadTitle'

/** 기존 모바일 행 그대로(묶음 안에서도 같은 모양). */
function MobileRow({ it }: { it: IssueResponse }) {
  const w = primaryWork(it.agentWork)
  const state = displayState(it)
  const tid = `ai-row-${it.id}`
  return (
    <li className="border-b px-1 py-2.5" data-testid={tid}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0"><IssueStatusIcon status={it.status} /></span>
        <div className="min-w-0 flex-1">
          <Link
            to={`/projects/${it.projectKey}/issues/${it.number}`}
            className="line-clamp-2 break-words text-sm font-medium leading-snug"
          >
            {it.title}
          </Link>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            {/* 메타 줄 — 항목은 줄지 않고(shrink-0) 넘치면 줄바꿈(flex-wrap). overflow-hidden 으로 자르지 않는다. */}
            <div
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 whitespace-nowrap text-xs text-muted-foreground"
              data-testid={`${tid}-meta`}
            >
              <span className="shrink-0 font-mono">{it.projectKey}-{it.number}</span>
              {state && <AgentStateBadge state={state} data-testid={`${tid}-state`} />}
              {w && <AgentToolChip tool={w.tool} data-testid={`${tid}-tool`} />}
              {w && <AgentProgress w={w} variant="text" hideEmpty className="shrink-0" data-testid={`${tid}-progress`} />}
              {w && <AgentLastReport w={w} className="shrink-0" endedLabel data-testid={`${tid}-last`} />}
            </div>
            <AiTaskAssignee issue={it} work={w} />
          </div>
          {w?.note && (
            <p className="mt-1 truncate text-xs text-muted-foreground" title={w.note} data-testid={`${tid}-note`}>
              {w.note}
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

/** 에픽 묶음 머리 — 이슈 목록 모바일 그룹 머리(bg-muted/40)와 같은 모양: 아이콘·키·제목·하위 진행.
 *  에픽 자신의 AI 작업이 있을 때만 머리 아래 메타 한 줄에 AI 진행·최근 보고. */
function MobileEpicHead({ epic, head }: { epic: EpicHead; head: IssueResponse | null }) {
  const w = head ? primaryWork(head.agentWork) : null
  const state = head ? displayState(head) : null
  const tid = `ai-epic-${epic.number}`
  return (
    <li className="border-b bg-muted/40 px-1 py-2" data-testid={tid}>
      <div className="flex min-h-7 min-w-0 items-center gap-1.5">
        <EpicHeadTitle epic={epic} tid={tid} />
      </div>
      {head && state && (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-[22px] text-xs text-muted-foreground" data-testid={`${tid}-meta`}>
          <AgentStateBadge state={state} />
          {w?.note && <span className="min-w-0 truncate" title={w.note}>{w.note}</span>}
        </div>
      )}
    </li>
  )
}

export function AiTasksMobileList({ items }: { items: IssueResponse[] }) {
  return (
    <ul className="text-sm">
      {splitByProject(items).map((run, i) => {
        const tid = `ai-project-${run.key}-head`
        return (
          <Fragment key={`${run.key}-${run.items[0].id}`}>
            <li className={cn('border-b px-1 pb-2', i === 0 ? 'pt-1' : 'pt-6')} data-testid={tid}>
              <ProjectHeadTitle run={run} tid={tid} />
            </li>
            {groupAiTasks(run.items).map((e) =>
              e.kind === 'row' ? (
                <MobileRow key={e.issue.id} it={e.issue} />
              ) : (
                <Fragment key={e.key}>
                  <MobileEpicHead epic={e.epic} head={e.head} />
                  {e.children.map((c) => <MobileRow key={c.id} it={c} />)}
                </Fragment>
              ),
            )}
          </Fragment>
        )
      })}
    </ul>
  )
}
