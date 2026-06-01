// 이슈 목록 테이블 — ID/제목/상태/우선순위. 내 작업·AI 위임 등 여러 뷰에서 공유.
import { Link } from 'react-router-dom'

import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge'
import { LabelChip } from '../labels/LabelChip'
import type { IssueResponse } from '../../types/issue'
import { IssuePriorityBadge } from '../../pages/projects/components/IssuePriorityBadge'
import { IssueStatusBadge } from '../../pages/projects/components/IssueStatusBadge'

export function IssueListTable({
  items,
  rowTestIdPrefix,
}: {
  items: IssueResponse[]
  /** 행 testid 접두어 — 예: "watched-row" → "watched-row-12". */
  rowTestIdPrefix: string
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
                <IssueStatusBadge status={it.status} />
              </td>
              <td>
                <IssuePriorityBadge priority={it.priority} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
