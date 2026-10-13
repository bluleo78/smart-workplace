// AI 위임 작업 모바일 목록(WP-377) — 프로젝트 이슈 목록 모바일 행(IssueRowMobileCell)과 같은 구조:
// 1줄 상태 아이콘 + 제목(2줄) / 2줄 메타(키 · AI 진행 · 에이전트 유형 · 진행률 · 마지막 보고 … 담당자) / 3줄 최근 보고(한 줄).
// 메타 줄이 좁으면 에이전트 유형 칩이 먼저 줄어들고(말줄임), 마지막 보고는 잘리지 않는다.
import { Link } from 'react-router-dom'

import {
  AgentLastReport,
  AgentProgress,
  AgentStateBadge,
  AgentToolChip,
} from '@/components/ai/agentWork/AgentWorkBits'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import { displayState, primaryWork } from '@/lib/agentWork'
import type { IssueResponse } from '@/types/issue'

import { AiTaskAssignee } from './AiTasksTable'

export function AiTasksMobileList({ items }: { items: IssueResponse[] }) {
  return (
    <ul className="text-sm">
      {items.map((it) => {
        const w = primaryWork(it.agentWork)
        const state = displayState(it)
        const tid = `ai-row-${it.id}`
        return (
          <li key={it.id} className="border-b px-1 py-2.5" data-testid={tid}>
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
                  {/* 메타 줄 — overflow-hidden 으로 넘침을 막되, 줄어드는 건 유형 칩뿐(나머지는 shrink-0). */}
                  <div
                    className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
                    data-testid={`${tid}-meta`}
                  >
                    <span className="shrink-0 font-mono">{it.projectKey}-{it.number}</span>
                    {state && <AgentStateBadge state={state} data-testid={`${tid}-state`} />}
                    {w && <AgentToolChip tool={w.tool} className="min-w-0 shrink" data-testid={`${tid}-tool`} />}
                    {w && <AgentProgress w={w} compact hideEmpty className="shrink-0" data-testid={`${tid}-progress`} />}
                    {w && <AgentLastReport w={w} className="shrink-0" data-testid={`${tid}-last`} />}
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
      })}
    </ul>
  )
}
