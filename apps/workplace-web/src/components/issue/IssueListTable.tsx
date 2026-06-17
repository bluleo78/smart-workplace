// 이슈 목록 테이블 — ID/제목/상태/우선순위. 내 작업·AI 위임 등 여러 뷰에서 공유.
// 상태·우선순위는 프로젝트 이슈 목록과 시각 언어 통일을 위해 아이콘 방식 사용(#294).
import { Link } from 'react-router-dom'

import { IssuePriorityBars } from '../issues/IssuePriorityBars'
import { IssueStatusIcon } from '../issues/IssueStatusIcon'
import type { IssueResponse } from '../../types/issue'
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge'
import { LabelChip } from '../labels/LabelChip'
import { UserAvatar } from '../users/UserAvatar'

export function IssueListTable({
  items,
  rowTestIdPrefix,
  showAssignees = false,
}: {
  items: IssueResponse[]
  /** 행 testid 접두어 — 예: "watched-row" → "watched-row-12". */
  rowTestIdPrefix: string
  // AI 위임 페이지는 어느 AI 담당인지가 핵심 → opt-in 으로 담당자 칩(아바타+AGENT 마커) 표시.
  // 공유 테이블 기본 off 로 내 작업 뷰(MyTasks)는 출력 무영향.
  showAssignees?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-2 w-32">ID</th>
            <th>제목</th>
            <th className="w-28">상태</th>
            <th className="w-24">우선순위</th>
            {showAssignees && <th className="w-20">담당자</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.id}
              className="border-b hover:bg-accent"
              data-testid={`${rowTestIdPrefix}-${it.id}`}
            >
              <td className="py-2 font-mono text-muted-foreground">
                {it.projectKey}-{it.number}
              </td>
              <td>
                <div className="flex items-center gap-2">
                  {it.type && <IssueTypeBadge type={it.type} size="sm" />}
                  <Link
                    to={`/projects/${it.projectKey}/issues/${it.number}`}
                    className="hover:underline font-medium"
                  >
                    {it.title}
                  </Link>
                </div>
                {it.labels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {it.labels.map((l) => (
                      <LabelChip key={l.id} label={l} size="sm" />
                    ))}
                  </div>
                )}
              </td>
              <td>
                <IssueStatusIcon status={it.status} />
              </td>
              <td>
                <IssuePriorityBars priority={it.priority} />
              </td>
              {showAssignees && (
                <td>
                  <span className="flex items-center -space-x-1">
                    {it.assignees.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        {it.assignees.slice(0, 3).map((u) => (
                          // AGENT(AI) 담당자는 보라색 ring + Bot 마커로 사람과 시각 구분.
                          <UserAvatar
                            key={u.id}
                            user={u}
                            size="xs"
                            ring
                            agent={u.kind === 'AGENT'}
                          />
                        ))}
                        {it.assignees.length > 3 && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            +{it.assignees.length - 3}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
