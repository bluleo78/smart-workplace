// 이슈 목록 테이블 — ID/제목/상태/우선순위. 내 작업 탭들이 공유(AI 위임 작업은 전용 표 — pages/me/aiTasks).
// 상태·우선순위는 프로젝트 이슈 목록과 시각 언어 통일을 위해 아이콘 방식 사용(#294).
// 모바일(<1024px)은 표 대신 프로젝트 이슈 목록 모바일 행(IssueRowMobileCell)과 같은 2줄 행을 그린다(WP-630) —
// 고정 폭 칸(ID·상태·우선순위)이 390px 폭을 다 먹어 제목이 한두 글자씩 접히던 문제.
import { Link } from 'react-router-dom'

import { useIsMobile } from '../../hooks/useIsMobile'
import { IssueMobileMeta } from '../../pages/projects/components/IssueMobileMeta'
import type { IssueResponse } from '../../types/issue'
import { IssuePriorityBars } from '../issues/IssuePriorityBars'
import { IssueStatusIcon } from '../issues/IssueStatusIcon'
import { IssueTypeBadge } from '../issueTypes/IssueTypeBadge'
import { LabelChip } from '../labels/LabelChip'

export function IssueListTable({
  items,
  rowTestIdPrefix,
}: {
  items: IssueResponse[]
  /** 행 testid 접두어 — 예: "watched-row" → "watched-row-12". */
  rowTestIdPrefix: string
}) {
  const isMobile = useIsMobile()
  if (isMobile) return <IssueMobileList items={items} rowTestIdPrefix={rowTestIdPrefix} />
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
                {/* 배지는 줄지 않게(shrink-0) — 긴 제목에 밀려 「작업」 이 음절 단위로 접히지 않도록(WP-630). */}
                <div className="flex min-w-0 items-center gap-2">
                  {it.type && (
                    <span className="shrink-0 whitespace-nowrap">
                      <IssueTypeBadge type={it.type} size="sm" />
                    </span>
                  )}
                  <Link
                    to={`/projects/${it.projectKey}/issues/${it.number}`}
                    className="min-w-0 break-words hover:underline font-medium"
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
                <IssueStatusIcon status={it.status} name={it.statusName} />
              </td>
              <td>
                <IssuePriorityBars priority={it.priority} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 모바일 행 — 1줄 상태 아이콘 + 제목(최대 2줄) / 2줄 메타(키 · ◆에픽 · 높음·마감·하위·라벨 … 담당자).
 *  여러 프로젝트가 섞인 목록이라 키·링크는 행마다 이슈의 projectKey 로 만든다. */
function IssueMobileList({ items, rowTestIdPrefix }: { items: IssueResponse[]; rowTestIdPrefix: string }) {
  return (
    <ul>
      {items.map((it) => {
        const tid = `${rowTestIdPrefix}-${it.id}`
        return (
          <li key={it.id} className="border-b px-1 py-2.5" data-testid={tid}>
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 shrink-0">
                <IssueStatusIcon status={it.status} name={it.statusName} />
              </span>
              <div className="min-w-0 flex-1">
                <Link
                  to={`/projects/${it.projectKey}/issues/${it.number}`}
                  data-testid={`${tid}-title`}
                  className="line-clamp-2 break-words text-sm font-medium leading-snug"
                >
                  {it.title}
                </Link>
                <IssueMobileMeta issue={it} projectKey={it.projectKey} testIdPrefix={tid} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
